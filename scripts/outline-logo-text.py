"""Replace <text> in logo SVGs with outlined paths, shaped by HarfBuzz from the app's Inter file.

Authoring tool, not part of the app (see design/logo/README.md).
usage: python scripts/outline-logo-text.py FONT.woff2 SRC.svg DST.svg
Mimics Chrome: CSS letter-spacing is added after every glyph (including the last), and
text-anchor=middle centres on that full advance.
"""
import io, re, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import uharfbuzz as hb

font_path, src, dst = sys.argv[1:4]
font = TTFont(font_path)
axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes}
font = instancer.instantiateVariableFont(font, {"wght": 400})
font.flavor = None  # HarfBuzz needs plain sfnt, not WOFF2
buf = io.BytesIO(); font.save(buf); data = buf.getvalue()
upem = font["head"].unitsPerEm
glyphset = font.getGlyphSet()
hb_font = hb.Font(hb.Face(data))

def attr(tag, name, default=None):
    m = re.search(rf'\s{name}="([^"]*)"', tag)
    return m.group(1) if m else default

def outline(m):
    tag, content = m.group(1), m.group(2)
    if attr(tag, "font-weight", "400") != "400":
        raise SystemExit(f"unexpected weight in {src}")
    x, y = float(attr(tag, "x")), float(attr(tag, "y"))
    size, ls = float(attr(tag, "font-size")), float(attr(tag, "letter-spacing", "0"))
    anchor, fill = attr(tag, "text-anchor", "start"), attr(tag, "fill")
    b = hb.Buffer(); b.add_str(content); b.guess_segment_properties()
    hb.shape(hb_font, b, {"kern": True, "liga": True})
    s = size / upem
    pens, pen_x = [], 0.0
    if any(i.codepoint == 0 for i in b.glyph_infos):
        raise SystemExit(f"missing glyph (.notdef) while shaping {content!r} in {src}")
    for info, pos in zip(b.glyph_infos, b.glyph_positions):
        pens.append((font.getGlyphName(info.codepoint), pen_x + pos.x_offset * s))
        pen_x += pos.x_advance * s + ls
    start = x - {"start": 0, "middle": pen_x / 2, "end": pen_x}[anchor]
    svg = SVGPathPen(glyphset, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    for name, gx in pens:
        glyphset[name].draw(TransformPen(svg, (s, 0, 0, -s, start + gx, y)))
    return f'<path d="{svg.getCommands()}" fill="{fill}"/>'

text = open(src).read()
out, n = re.subn(r"<text([^>]*)>([^<]*)</text>", outline, text)
open(dst, "w").write(out)
print(f"{dst}: {n} text runs outlined; font axes {axes}")
