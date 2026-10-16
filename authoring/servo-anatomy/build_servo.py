"""Generic micro servo anatomy, scripted in Blender (offline authoring only; M4, 16 Oct 2026).

Generic, illustrative, NOT measured, NOT a named product. Nothing here runs in the live app; the
outputs (a GLB and its manifest) stay review_status "draft" until a person reviews them.

Run (from the repo root): npm run author:servo   (finds Blender from BLENDER_BIN or authoring/local.json)
or directly:  blender --background --factory-startup --python build_servo.py -- --out <dir> --stills <dir>

Units: metres. Blender is Z-up; the output shaft axis is Blender +Z, which the glTF exporter turns
into glTF +Y (Y-up). Every part's origin sits on that axis, so exploding moves parts along it only.
The gear train comes from gears.json (the single source of truth); the ratio is derived from it.
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Vector

# ── Parameters (metres) ───────────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
GEARS_FILE = os.path.join(HERE, "gears.json")
BUDGET_TRIANGLES = 8000  # provisional (Lucky, 16 Oct 2026): re-check on the real Android phone
BUDGET_GLB_KB = 300

CASE_X = (-0.0055, 0.0175)  # length 23 mm; the output shaft (x = 0) sits near one end
CASE_Y = (-0.0061, 0.0061)  # width 12.2 mm
WALL = 0.0008
BOTTOM_Z = (0.0, 0.0012)  # bottom cover
BOARD_Z = (0.0014, 0.0020)
HOUSING_Z = (0.0012, 0.0225)  # middle and upper case as one housing, open at the bottom
EARS = {"length": 0.0325, "width": 0.0122, "z": (0.0150, 0.0170)}  # mounting ears span
BOSS = {"radius": 0.0030, "z": (0.0225, 0.0245)}
GEAR_Z0 = 0.0160  # lowest gear layer
SHAFT_RADIUS = 0.0006
SPLINE = {"radius": 0.0012, "ridges": 12, "z": (0.0245, 0.0270)}
HORN = {"length": 0.016, "width": 0.0035, "thickness": 0.0015, "z0": 0.0262, "hub_radius": 0.0025, "screw_radius": 0.0009}
MOTOR = {"radius": 0.0025, "z": (0.0035, 0.0140)}
POT = {"radius": 0.0020, "z": (0.0060, 0.0110)}
# Layout of the shafts (not the ratio): the angle at which each next shaft sits from the one it drives, degrees.
SHAFT_ANGLES_DEG = {"stage-2": 0.0, "stage-1": 170.0, "motor": 0.0}
FLANK_POINTS = 3  # points per tooth flank (involute approximation): low poly
SEGMENTS = 16  # round parts

# Explode along the shaft axis (+Z in Blender), metres; the housing must clear the gears.
EXPLODE = {"horn": 0.060, "upper-case": 0.044, "gear-train": 0.020, "motor-and-sensor": 0.0, "board-and-cover": -0.012}

# Flat PBR colours: brand palette, plus silver for the motor (an approved exception, Lucky 16 Oct 2026).
COLOURS = {
    "case": ("#282724", 0.0, 0.55),  # Ink: dark neutral
    "gear": ("#C99A56", 0.1, 0.45),  # Gold
    "board": ("#83957E", 0.0, 0.6),  # Sage
    "sensor": ("#917383", 0.0, 0.5),  # Plum
    "horn": ("#F5F1EB", 0.0, 0.5),  # Canvas: light neutral
    "motor": ("#B8BCC2", 0.6, 0.35),  # silver: the one exception to the palette
}

PARTS = [
    ("horn", "Output horn and screw", "Carries the load: the arm or linkage bolts to it; the screw holds it on the splined shaft."),
    ("upper-case", "Upper case", "Holds the gear train; the mounting ears bolt the servo down; the boss guides the output shaft."),
    ("gear-train", "Gear train", "Trades speed for torque: a small motor pinion drives larger gears, stage by stage, to the splined output shaft."),
    ("motor-and-sensor", "Motor and position sensor", "The motor turns fast with little torque; the potentiometer on the output shaft tells the board the angle."),
    ("board-and-cover", "Control board and bottom cover", "The board compares the commanded angle with the sensor and drives the motor; the cover closes the case."),
]

RENDER = {"width": 1280, "height": 960, "cycles_samples": 24}


# ── Helpers ───────────────────────────────────────────────────────────────────────────────────
def args():
    a = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = {"out": os.path.join(HERE, "out"), "stills": os.path.join(HERE, "stills")}
    for i, k in enumerate(a):
        if k in ("--out", "--stills") and i + 1 < len(a):
            out[k[2:]] = a[i + 1]
    return out


def hex_rgba(h):
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1.0)


def material(key):
    name = f"aili-{key}"
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    colour, metallic, rough = COLOURS[key]
    m = bpy.data.materials.new(name)
    if hasattr(m, "use_nodes"):
        try:
            m.use_nodes = True
        except Exception:
            pass
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.node_tree else None
    if bsdf is None and m.node_tree:
        bsdf = m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL"), None) or m.node_tree.nodes.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(bsdf.outputs[0], out.inputs[0])
    rgba = hex_rgba(colour)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = rgba  # the Workbench colour
    m.metallic = metallic
    m.roughness = rough
    return m


def mesh_object(name, bm, mat_key):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(material(mat_key))
    return ob


def box(name, x, y, z, mat_key):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x[0] if v.co.x < 0 else x[1]
        v.co.y = y[0] if v.co.y < 0 else y[1]
        v.co.z = z[0] if v.co.z < 0 else z[1]
    return mesh_object(name, bm, mat_key)


def prism(name, outline, z, mat_key, centre=(0.0, 0.0)):
    """Extrude a closed 2D outline (list of (x, y), counter-clockwise) between z[0] and z[1]."""
    bm = bmesh.new()
    verts = [bm.verts.new((centre[0] + px, centre[1] + py, z[0])) for px, py in outline]
    face = bm.faces.new(verts)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=(0.0, 0.0, z[1] - z[0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_object(name, bm, mat_key)


def circle(radius, n=SEGMENTS):
    return [(radius * math.cos(2 * math.pi * i / n), radius * math.sin(2 * math.pi * i / n)) for i in range(n)]


def involute(alpha):
    return math.tan(alpha) - alpha


def gear_outline(teeth, module, pressure_deg, phase=0.0):
    """Spur gear outline: addendum m, dedendum 1.25 m, involute flanks approximated with FLANK_POINTS."""
    r = module * teeth / 2
    rb = r * math.cos(math.radians(pressure_deg))
    ra = r + module
    rf = max(r - 1.25 * module, 0.4 * r)
    half_pitch = math.pi / (2 * teeth)  # half the tooth thickness at the pitch circle, as an angle
    inv_p = involute(math.radians(pressure_deg))
    pts = []
    r0 = max(rb, rf)
    for i in range(teeth):
        c = phase + 2 * math.pi * i / teeth
        flank = []
        for k in range(FLANK_POINTS):
            rr = r0 + (ra - r0) * k / (FLANK_POINTS - 1)
            a = math.acos(min(1.0, rb / rr))
            flank.append((rr, half_pitch + inv_p - involute(a)))
        root_off = flank[0][1]
        pts.append((rf, c - root_off - 0.15 / teeth))
        pts += [(rr, c - off) for rr, off in flank]
        pts += [(rr, c + off) for rr, off in reversed(flank)]
        pts.append((rf, c + root_off + 0.15 / teeth))
    return [(rr * math.cos(t), rr * math.sin(t)) for rr, t in pts]


def join(name, objs):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def origin_on_axis(ob, z):
    """Move the object's origin to (0, 0, z): on the output-shaft axis, without moving the geometry."""
    offset = Vector((0.0, 0.0, z)) - ob.location
    ob.data.transform(__import__("mathutils").Matrix.Translation(-offset))
    ob.location = Vector((0.0, 0.0, z))


# ── Build ─────────────────────────────────────────────────────────────────────────────────────
def load_gears():
    with open(GEARS_FILE, encoding="utf8") as f:
        g = json.load(f)
    assert g["label"] == "illustrative example values, not measured", "gears.json must keep its label"
    gears = {x["id"]: x for x in g["gears"]}
    ratio = 1.0
    for m in g["meshes"]:
        ratio *= gears[m["driven"]]["teeth"] / gears[m["driver"]]["teeth"]  # driven ÷ driver, per mesh
    return g, gears, ratio


def shaft_positions(g, gears):
    """Shaft centres from the meshes: each driver sits at the meshing centre distance from its driven gear."""
    m = g["module_m"]
    pos = {"output": (0.0, 0.0)}
    for mesh in reversed(g["meshes"]):
        driver, driven = gears[mesh["driver"]], gears[mesh["driven"]]
        d = m * (driver["teeth"] + driven["teeth"]) / 2
        base = pos[driven["shaft"]]
        a = math.radians(SHAFT_ANGLES_DEG[driver["shaft"]])
        pos[driver["shaft"]] = (base[0] + d * math.cos(a), base[1] + d * math.sin(a))
    return pos


def build(g, gears):
    m = g["module_m"]
    pa = g["pressure_angle_deg"]
    pos = shaft_positions(g, gears)
    parts = {}

    # 3. Gear train: layers from the motor pinion up to the output gear; each driven gear is turned
    # half a tooth so its teeth sit in the driver's gaps.
    layer = {"motor-pinion": 0, "stage-1-gear": 0, "stage-1-pinion": 1, "stage-2-gear": 1, "stage-2-pinion": 2, "output-gear": 2}
    objs = []
    for gid, gear in gears.items():
        z0 = GEAR_Z0 + layer[gid] * 0.0018
        phase = math.pi / gear["teeth"] if gid.endswith("gear") else 0.0
        objs.append(prism(gid, gear_outline(gear["teeth"], m, pa, phase), (z0, z0 + gear["face_width_m"]), "gear", pos[gear["shaft"]]))
    for shaft, (x, y) in pos.items():
        if shaft in ("output", "motor"):
            continue
        objs.append(prism(f"shaft-{shaft}", circle(SHAFT_RADIUS, 8), (GEAR_Z0 - 0.0005, GEAR_Z0 + 0.0055), "gear", (x, y)))
    out_top = GEAR_Z0 + 2 * 0.0018 + gears["output-gear"]["face_width_m"]
    objs.append(prism("output-shaft", circle(SPLINE["radius"] * 0.8, 12), (out_top, SPLINE["z"][0]), "gear"))
    ridges = SPLINE["ridges"]
    star = []
    for i in range(2 * ridges):
        rr = SPLINE["radius"] if i % 2 == 0 else SPLINE["radius"] * 0.82
        t = math.pi * i / ridges
        star.append((rr * math.cos(t), rr * math.sin(t)))
    objs.append(prism("splined-shaft", star, SPLINE["z"], "gear"))
    parts["gear-train"] = join("gear-train", objs)

    # 4. Motor (under the motor pinion) and potentiometer (under the output shaft).
    mx, my = pos["motor"]
    objs = [
        prism("motor-can", circle(MOTOR["radius"]), MOTOR["z"], "motor", (mx, my)),
        prism("motor-shaft", circle(SHAFT_RADIUS * 0.6, 8), (MOTOR["z"][1], GEAR_Z0), "motor", (mx, my)),
        prism("potentiometer", circle(POT["radius"]), POT["z"], "sensor"),
        prism("pot-shaft", circle(SHAFT_RADIUS * 0.8, 8), (POT["z"][1], GEAR_Z0), "sensor"),
    ]
    parts["motor-and-sensor"] = join("motor-and-sensor", objs)

    # 5. Control board and bottom cover.
    objs = [
        box("bottom-cover", CASE_X, CASE_Y, BOTTOM_Z, "case"),
        box("control-board", (CASE_X[0] + WALL, CASE_X[1] - WALL), (CASE_Y[0] + WALL, CASE_Y[1] - WALL), BOARD_Z, "board"),
    ]
    parts["board-and-cover"] = join("board-and-cover", objs)

    # 2. Upper case: the housing walls and top (open at the bottom), the mounting ears and the shaft boss.
    x0, x1 = CASE_X
    y0, y1 = CASE_Y
    z0, z1 = HOUSING_Z
    ear_x = ((x0 + x1) / 2 - EARS["length"] / 2, (x0 + x1) / 2 + EARS["length"] / 2)
    objs = [
        box("wall-front", (x0, x1), (y0, y0 + WALL), (z0, z1), "case"),
        box("wall-back", (x0, x1), (y1 - WALL, y1), (z0, z1), "case"),
        box("wall-left", (x0, x0 + WALL), (y0, y1), (z0, z1), "case"),
        box("wall-right", (x1 - WALL, x1), (y0, y1), (z0, z1), "case"),
        box("top", (x0, x1), (y0, y1), (z1 - WALL, z1), "case"),
        box("ears", ear_x, (y0, y1), EARS["z"], "case"),
        prism("shaft-boss", circle(BOSS["radius"]), BOSS["z"], "case"),
    ]
    parts["upper-case"] = join("upper-case", objs)

    # 1. Output horn and screw.
    hz = HORN["z0"]
    objs = [
        box("horn-arm", (-HORN["length"] / 2, HORN["length"] / 2), (-HORN["width"] / 2, HORN["width"] / 2), (hz, hz + HORN["thickness"]), "horn"),
        prism("horn-hub", circle(HORN["hub_radius"]), (SPLINE["z"][0], hz + HORN["thickness"]), "horn"),
        prism("horn-screw", circle(HORN["screw_radius"], 12), (hz + HORN["thickness"], hz + HORN["thickness"] + 0.0008), "motor"),
    ]
    parts["horn"] = join("horn", objs)

    # Every origin on the output-shaft axis (x = y = 0), at the part's lowest point.
    for name, ob in parts.items():
        zs = [v.co.z for v in ob.data.vertices]
        origin_on_axis(ob, min(zs))
    return parts, pos


def triangles(objs):
    n = 0
    for ob in objs:
        ob.data.calc_loop_triangles()
        n += len(ob.data.loop_triangles)
    return n


# ── Stills ────────────────────────────────────────────────────────────────────────────────────
def setup_lights_and_camera():
    sun = bpy.data.lights.new("key", "SUN")
    sun.energy = 3.0
    so = bpy.data.objects.new("key", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(so)
    cam = bpy.data.cameras.new("camera")
    cam.type = "ORTHO"
    cam.clip_start = 0.0001
    cam.clip_end = 2.0
    co = bpy.data.objects.new("camera", cam)
    bpy.context.collection.objects.link(co)
    bpy.context.scene.camera = co
    world = bpy.data.worlds.new("world") if not bpy.context.scene.world else bpy.context.scene.world
    bpy.context.scene.world = world
    world.color = hex_rgba("#EBE4DA")[:3]
    return co


def frame(cam, objs, direction, margin=1.25):
    """Point an orthographic camera along `direction` at the objects' bounding box."""
    bpy.context.view_layer.update()  # moved parts: refresh their world matrices before framing
    pts = [ob.matrix_world @ Vector(c) for ob in objs for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    size = (hi - lo).length
    d = Vector(direction).normalized()
    cam.location = centre + d * size * 3
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y" if abs(d.z) < 0.99 else "X").to_euler()
    # Fit the view to the parts' extent as the camera sees them (width and height), not the diagonal.
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    local = [inv @ p for p in pts]
    w = max(p.x for p in local) - min(p.x for p in local)
    h = max(p.y for p in local) - min(p.y for p in local)
    aspect = RENDER["width"] / RENDER["height"]
    cam.data.ortho_scale = max(w, h * aspect) * margin
    # Centre on the projected extent (the bounding-box centre is not the picture's centre at an angle).
    mid = Vector(((max(p.x for p in local) + min(p.x for p in local)) / 2, (max(p.y for p in local) + min(p.y for p in local)) / 2, 0.0))
    cam.location = cam.matrix_world @ mid


def render_still(path, engine):
    scene = bpy.context.scene
    scene.render.engine = engine
    scene.render.resolution_x = RENDER["width"]
    scene.render.resolution_y = RENDER["height"]
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    if engine == "BLENDER_WORKBENCH":
        sh = scene.display.shading
        sh.light = "STUDIO"
        sh.color_type = "MATERIAL"
        sh.show_cavity = True
        sh.show_object_outline = True
        scene.display.render_aa = "8"
    else:
        scene.cycles.device = "CPU"
        scene.cycles.samples = RENDER["cycles_samples"]
        scene.cycles.use_denoising = True
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t0


def stills(parts, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    cam = setup_lights_and_camera()
    all_parts = list(parts.values())
    views = []
    iso = (1.0, -1.3, 0.9)
    views.append(("assembled", all_parts, iso, None))
    views.append(("exploded", all_parts, (1.0, -1.6, 0.35), "explode"))
    views.append(("gear-train", [parts["gear-train"]], (0.7, -1.0, 1.2), "gears-only"))
    views.append(("top", all_parts, (0.0, 0.0, 1.0), None))  # the output shaft points at the viewer
    report = []
    engine = None
    for name, objs, direction, mode in views:
        base = {n: ob.location.copy() for n, ob in parts.items()}
        hidden = []
        if mode == "explode":
            for n, ob in parts.items():
                ob.location.z += EXPLODE[n]
        if mode == "gears-only":
            for n, ob in parts.items():
                if n != "gear-train":
                    ob.hide_render = True
                    hidden.append(ob)
        frame(cam, objs, direction, margin=1.15 if mode != "explode" else 1.1)
        path = os.path.join(out_dir, f"servo-{name}.png")
        tried = [engine] if engine else ["BLENDER_WORKBENCH", "CYCLES"]
        err = None
        for e in tried:
            try:
                seconds = render_still(path, e)
                engine = e
                report.append({"still": path, "engine": e, "seconds": round(seconds, 2)})
                err = None
                break
            except Exception as ex:  # a renderer that cannot start headless: try the next one
                err = f"{e}: {ex}"
                print(f"[servo] render with {e} failed: {ex}")
        if err:
            report.append({"still": path, "engine": None, "error": err})
        for ob in hidden:
            ob.hide_render = False
        for n, ob in parts.items():
            ob.location = base[n]
    return report


# ── Main ──────────────────────────────────────────────────────────────────────────────────────
def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    g, gears, ratio = load_gears()
    parts, pos = build(g, gears)

    tris = triangles(parts.values())
    os.makedirs(a["out"], exist_ok=True)
    glb = os.path.join(a["out"], "servo-generic.glb")
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_yup=True, export_apply=True, export_cameras=False, export_lights=False)
    size_kb = os.path.getsize(glb) / 1024
    print(f"[servo] triangles {tris} (budget {BUDGET_TRIANGLES}), GLB {size_kb:.1f} KB (budget {BUDGET_GLB_KB} KB), ratio {ratio:.4f}")

    manifest = {
        "id": "asset.servo-generic-anatomy",
        "type": "asset",
        "version": "0.1.0",
        "title": "Generic micro servo: anatomy",
        "label": "Generic micro servo, illustrative, not measured, not a named product",
        "fidelity": "illustrative",
        "provenance": "scripted in Blender 5.2.2, generic, not measured",
        "license": "own work",
        "review_status": "draft",
        "format": "glb",
        "file": "servo-generic.glb",
        "size_kb": round(size_kb, 1),
        "triangles": tris,
        "budget": {"triangles": BUDGET_TRIANGLES, "glb_kb": BUDGET_GLB_KB, "status": "provisional: re-check on the real Android phone before page integration (Lucky, 16 Oct 2026)"},
        "units": "metres",
        "shaft_axis": {"blender": "+Z (Blender is Z-up)", "gltf": "+Y (the glTF exporter converts to Y-up)", "origin": "every part's origin lies on the output-shaft axis (x = 0, z = 0 in glTF), at the part's lowest point"},
        "parts": [
            {"id": pid, "name": name, "role": role, "node": pid, "explode": {"direction_gltf": [0, 1 if EXPLODE[pid] >= 0 else -1, 0], "distance_m": abs(EXPLODE[pid])}}
            for pid, name, role in PARTS
        ],
        "materials": {
            "palette": {"case": "Ink #282724", "gears": "Gold #C99A56", "board": "Sage #83957E", "sensor": "Plum #917383", "horn": "Canvas #F5F1EB"},
            "exceptions": [{"part": "motor-and-sensor", "colour": "silver #B8BCC2", "why": "a motor can reads as metal; approved exception to the palette (Lucky, 16 Oct 2026)"}],
        },
        "gear_train": {
            "source": "gears.json",
            "label": g["label"],
            "module_m": g["module_m"],
            "meshes": [f'{gears[m["driver"]]["teeth"]} → {gears[m["driven"]]["teeth"]}' for m in g["meshes"]],
            "ratio": ratio,
            "ratio_note": "derived by code from the tooth counts (driven ÷ driver per mesh); never typed by hand",
            "accuracy": "involute flanks approximated with a few points; no backlash, profile shift or tolerance; for looks only",
        },
        "teaches": ["act.servo-parts", "act.servo-what-it-is"],
        "teaches_proposed": ["act.gear-ratio", "act.torque-speed-tradeoff", "sense.position-sensor", "act.motor-basics"],
        "teaches_note": "teaches lists concept IDs in content/robotics/concepts.json; teaches_proposed are in the M4 concept graph plan, not yet in concepts.json",
    }

    over = []
    if tris > BUDGET_TRIANGLES:
        over.append(f"{tris} triangles is over the {BUDGET_TRIANGLES} budget")
    if size_kb > BUDGET_GLB_KB:
        over.append(f"{size_kb:.1f} KB is over the {BUDGET_GLB_KB} KB budget")

    report = stills(parts, a["stills"])
    manifest["stills"] = [{"file": os.path.basename(r["still"]), "engine": r.get("engine"), "seconds": r.get("seconds")} for r in report]
    with open(os.path.join(a["out"], "servo-generic.manifest.json"), "w", encoding="utf8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("[servo] stills " + json.dumps(report))
    if over:
        print("[servo] BUDGET EXCEEDED: " + "; ".join(over))
        sys.exit(2)
    if any(r.get("engine") is None for r in report):
        print("[servo] RENDER FAILED: no renderer worked headless")
        sys.exit(3)


main()
