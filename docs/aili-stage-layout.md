# AILI — Stage Layouts: Learn Stage + Build Workbench (v0.2, Oct 9 2026)

Source: Lucky's hand-drawn sketch (`design/stage-sketch.jpg`, rotated 90°) and later direction. **[Lucky]** = specified by Lucky. **[Decision]** = engineer's decision (Lucky approved the two-stage structure and the parametric-first workbench on Oct 9). **[Confirm]** = my reading of something unclear, to be confirmed.

## 0. Structure [Lucky approved]
One app, **two stages, one shared engine**. This replaces the earlier "one stage only" rule.
- **Shared:** 3D engine and asset files (named parts), solvers, professor, voice + interrupt, Library, goal/plan/progress, accessibility rules, design tokens.
- **Learn stage:** Aili directs a scripted scene for one concept. Evidence of understanding is the output.
- **Build Workbench:** the learner directs a design made of several parts; Aili reviews. A design file is the output.
- Robotics is the only module. No mascot. No whiteboard/search.

## 1. Learn stage [Lucky sketch]
```
┌──────────────────────────────────────────────────────────┐
│ logo  menu                                               │
├───────────────────────────────────────┬──────────────────┤
│     STAGE: scene        │ explanation │ Text explanation │
│                         │ space       │ (usually closed) │
│               voice                   │          [Library]
└───────────────────────────────────────┴──────────────────┘
```
- **Top bar:** logo (→ Home/Resume), menu (**Plan** (planned), which opens the panel's Plan tab; notes, settings, help, sign out). Thin; no mode dashboards.
- **Stage:** large rounded canvas, **one active scene at a time**, with an **explanation space** at its right inside the stage when the scene has one (the servo + arm today): the equation built step by step with the solver's numbers and units, finished steps dimmed, the current one marked "Now" in text; the needed torque, the rating field and the margin gauge. For the drone altitude scene (Oct 21 2026) the explanation space holds the height plot with a faint ghost of the previous run, the P/I/D bars, the Kp/Ki/Kd sliders, the presets, the Run button and a checks strip (final error, overshoot, settling time, stability; Pass/Warn/Fail with icon and word); on phones it opens as the bottom sheet. It is still one scene, not a second panel. The diagram itself carries only short symbols (F, d, τ, W). The space is not a second scene and never animates on its own. From 1,100 px it is a column; narrower, it is a one-line strip (the current step, or the total) with a button that opens it as a sheet. When an analogy hands over to a real-part scene, the analogy may stay as a **docked recap** (planned): a small still picture in a corner, with its own badge (for example *Illustrative (AI-composed)*), never animating and never a second 3D view. Tapping it makes it the active scene again. A new scene that is not the analogy's partner clears it. Reduced motion: the handover is a cut. Phones: the recap is a small thumbnail with a tap target of at least 44 px, or a "Recap" chip when the stage is too small, and it hides while the inspector or a panel is open. **Setup cards (planned):** before the first scene exists, at most three short cards (level, time, goal), one after another on the empty stage, each with chips and a Skip option. They are not scenes and never return once the plan exists. Orbit/zoom/pan, select, labelled anatomy, exploded view, reset camera. Selecting a part opens a temporary inspector with sliders (units + bounds). The servo's rated torque is entered in the explanation space (the servo's inspector links to it). Status badge: *Prepared* / *Live AI* / *Illustrative (AI-composed)*. A live answer that uses test-fixture content also shows *Test fixture content*. Numbers come only from solvers. Reduced-motion: cuts, no tweens.
- **Voice (bottom-centre):** states idle / listening / thinking / speaking / error. **Interrupt** stops audio and queued actions immediately (stale actions invalidated by sequence numbers). Text box beside it; quick-reply chips for Aili's questions. Voice optional; falls back to text. Provider behind config; browser speech first.
- **Captions:** because the right panel is closed most of the time, a short caption overlay sits above the voice button, synchronised with speech.
- **Text explanation panel (right, on demand):** current explanation, equations with live values, evidence chips, open question, assumptions/limits; scrollable history; copy / pin note / "explain differently". **During equation steps the live equation is in the stage's explanation space**; the panel keeps the full record (inputs, outputs, evidence, limits). Show only the current step by default (split-attention); the explanation space shows finished steps dimmed and the current step marked, so the learner keeps the thread without reading back. **Plan tab (planned):** the study plan's table of contents (units in order, a checkpoint per unit, the current unit marked, done / not done by icon and label, an editable order within prerequisite limits), labelled "Draft plan, not yet expert-reviewed". Closed by default; opens once when the plan is first created. Never shown on the stage.
- **Library [Confirm]:** tab → drawer over the right panel: verified reading items + guides + teach-back prompts; learner-added sources marked "unverified".
- **Phone:** Stage on top, text panel as bottom sheet (with the Explanation and Library tabs; the Plan tab is planned), voice floating bottom-centre, Library inside the sheet. On phones the explanation space is a one-line "Now" strip above the captions, and an **Explanation space** button opens it in full as a sheet over the stage. Touch targets ≥44 px.

## 2. Build Workbench [Decision; Lucky: "like a test, guide… think Blender and workspace"]
A professional-tool layout: dense but calm, panels dockable/collapsible, keyboard shortcuts, undo/redo.
```
┌ logo  menu │ Design: pan-tilt v3 │ milestones ● ● ○ ○ │ undo redo ┐
│ Parts /    │                                      │ Properties     │
│ Outliner   │            VIEWPORT                  │ (selected part │
│ (tree of   │      (assembly, gizmos, labels)      │  settings,     │
│  parts +   │                                      │  datasheet src)│
│  catalog)  │              voice                   │ Guide / Tests  │
├ CHECKS: torque margin · mass · power · status ─────────────────────┤
│ Timeline / Log: design versions · test runs · measurements         │
└────────────────────────────────────────────────────────────────────┘
```
- **Parts / Outliner (left):** the design as a tree (base → servo → arm → camera), plus a curated catalog to add parts from. Each catalog part shows specs with source (datasheet) and fidelity.
- **Viewport (centre):** the assembly. Select, orbit, section/exploded view, measurement tool, per-part highlight when a check fails. Move/rotate gizmos only for parameters the part allows (parametric first).
- **Properties (right):** settings of the selected part as sliders/dropdowns with units and bounds; datasheet source link; "open lab for this" (side quest to the Learn stage).
- **Guide / Tests panel (right, tabbed):** *Guide* = the project template's milestones, steps and safety notes; *Tests* = the test plan, each test with expected result from the model, and a place to log the real measurement.
- **Checks strip (bottom):** live solver results (torque margin, mass; power budget later) with pass/warn/fail using icon + label (never colour alone). Failure explains which assumption is violated.
- **Timeline/Log (bottom, collapsible):** design versions, test runs, model-vs-reality measurements. Label "simulation only; hardware untested" until a real measurement is logged.
- **Aili in the Workbench:** voice + command bar as in the Learn stage, plus a review mode: Aili can critique the design, propose changes as **suggestions the learner accepts or rejects** — never silent edits. Pre-mortem/risk list and troubleshooting flow live here.
- **Phone:** view-only plus checks and guide; editing on tablet/desktop in V1. Say so honestly in the UI.

### Design file [Decision]
`design.json` = parts (catalog IDs + versions), parameters with units, connections, milestone state, test results, version history. It is the source of truth; the viewport and checks are derived from it. Same registry rules: catalog parts and solvers are versioned and reviewed; AI proposes, validators and humans approve.

### Connection between stages [Decision]
- **Learn → Build:** "Take this to the workbench" copies the lab settings into a new design.
- **Build → Learn:** a failing check or a milestone's `requires_concepts` opens the relevant lab as a side quest, then returns to the milestone.
- Both stages write to one learner state and one project dossier.

### Workbench V1 scope
In: curated parts catalog (datasheet-sourced), parametric assembly, live solver checks, parts list (BOM), wiring outline, test plan, measurement log, design versions.
Out (later): free drag-and-snap assembly, full CAD/STEP import, wiring simulation, firmware/code generation, live prices or stock. Aili must never invent these.

## 3. AR and VR [Decision — later, not V1]
- **What they are:** VR replaces your view with a virtual space (headset). AR overlays virtual objects on your real view (phone camera or see-through headset).
- **What the browser can do today** (from a testmuai browser-support page; verify before building): WebXR works in desktop/Android Chrome and Meta Quest Browser (VR, and AR/passthrough on AR-capable devices). visionOS Safari supports immersive VR but not AR yet. **Safari on iPhone does not support WebXR.** Three.js / React Three Fiber can render to WebXR, so the same scene files can be reused.
- **Where it helps AILI:** (1) AR "place the arm on your desk" to feel real scale and reach; (2) VR walkthrough of a robot's anatomy at full size; (3) AR overlay during building to check the physical layout against the design.
- **Why not V1:** most beta users will be on phones and laptops; iPhone has no WebXR; headsets are rare; it doubles testing. Prove the Learn stage and Workbench first.
- **Plan:** (a) keep scenes unit-correct (metres) and assets clean so they can be reused; (b) later add an optional "View in AR" for Android as a single-asset viewer; (c) VR for Quest only if learners ask for it. Treat XR as a viewer of the same scene, not a third stage.

## 4. Brand application
Stage/viewport on Deep canvas (#EBE4DA), panels on Surface (#FFFDFA), Ink text, primary actions Strong copper (#A7482F), Sky for technical/3D highlights, Sage for exploration states, Gold for discoveries. Pass/warn/fail use distinct icons and labels. The Workbench is denser than the Learn stage but uses the same tokens, type and spacing scale.

## 5. Build notes for Claude Code
- Shell and tokens first, then Learn stage (placeholder scene), voice states, text panel, Library drawer.
- One state store: scene state, revision number, request IDs (for interrupts). Workbench adds `design.json` with undo/redo history.
- Performance budget for a low-end Android phone (Itel A667L, Android 14): assets low-poly, size limits, lazy loading, a fallback viewer. Test on that real phone.

### Learn stage 3D budget [set in M1 slice 4a, Oct 10 2026]
Measured on a production build; enforced by `apps/web/e2e/scene.spec.ts` (the test fails if exceeded).
| Item | Budget | Measured (slice 4a) |
|---|---|---|
| 3D code loaded after the page (three.js, React Three Fiber, drei orbit controls, glTF loader, scene components) | **≤ 300 KB gzip** | 264.8 KB gzip (985 KB raw), 3 chunks (16 Oct 2026, with the glTF loader; was 251.6 KB) |
| Placeholder scene geometry | **≤ 2,000 triangles** | 132 |
| 3D asset files | none yet (the placeholder is built in code); real assets get a per-asset size budget in M4 | 0 |
- The 3D code is lazy-loaded: the rest of the stage (text box, voice, panels) works while it downloads (tested).
- Rendering is on demand only (no continuous frames); device pixel ratio capped at 1.5.
- If WebGL is unavailable or the context is lost, a still SVG picture of the parts replaces the 3D view; the parts list keeps working.
- These are lab measurements in headless Chrome. Real speed is judged on the low-end test phone (CLAUDE.md), slice 6.
