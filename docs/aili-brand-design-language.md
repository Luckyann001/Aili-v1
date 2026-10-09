# AILI — Brand Identity & Design Language V1 ("Tactile Spatialism")

Status: v0.2, Oct 9 2026. Labels: **[Lucky]** specified by Lucky, **[Inferred]** read from the images, **[Decision]** fixed by the technical engineer in line with AILI's direction (Lucky delegated these).

## 1. Direction [Lucky]
- Name: **Tactile Spatialism**. Pillars: tactile surfaces, spatial intelligence, editorial clarity, organic atmosphere.
- Working expressions: "From curiosity to creation." / "Think. Understand. Create." / "From curiosity to capability."
- Principles: Spatial, Adaptive, Tactile, Minimal, Expressive, Consistent.
- Avoid: generic neon AI graphics, crowded dashboards, excessive glassmorphism, decorative effects without purpose, a rainbow interface.
- Dark mode has its own semantic tokens. It is not an inverted light mode.

## 2. Palette and roles [Lucky]
| Token | Hex | Role |
|---|---|---|
| Canvas | #F5F1EB | Main learning canvas (warm ivory) |
| Deep canvas | #EBE4DA | Recessed areas |
| Surface | #FFFDFA | Cards |
| Ink | #282724 | Text and structure |
| Copper | #C96543 | Primary actions, attention, brand emphasis |
| Strong copper | #A7482F | Pressed state / small-text variant |
| Sage | #83957E | Exploration, supporting learning states |
| Sky | #8DAEB9 | Visualization and technical content |
| Gold | #C99A56 | Selective emphasis, discoveries |
| Plum | #917383 | Secondary expressive accents |

Supersedes the earlier rust (#B4532A) values in the master prompt and prototype.

## 3. Accessibility rules [Decision]
Computed WCAG ratios: Ink on Canvas 13.28; white/Surface on Copper 3.81 (fails normal text); Copper on Canvas 3.44; Strong copper on Canvas 5.17; Sage/Sky/Gold on Canvas 2.84/2.10/2.27; Ink on Sage 4.67, Sky 6.32, Gold 5.86.
- Primary buttons: Strong copper (#A7482F) background with Surface-colour label (5.17+ passes); copper #C96543 only for large decorative fills, focus rings and icons at 3:1 or better.
- Sage, Sky, Gold, Plum are fills/icons/3D materials only; text on them is Ink. Never as text on Canvas.
- Meaning is never colour-only: add icon, label or shape (copper vs sage is hard for some colour-blind users).
- Safety/warning states use a dedicated pattern (warning icon + "Safety" label + heavier border), not copper alone.
- Dark-mode tokens are authored separately and re-checked with the same ratios before shipping.
- All motion honours `prefers-reduced-motion`; every animation has a still alternative.

## 4. Typography [Decision]
Display serif: **Newsreader** (open, self-hosted) in place of Iowan Old Style (Apple-only); UI: **Inter** (self-hosted). Georgia as fallback.

## 5. Logo [Inferred + Decision]
- Mark: "A" with orbit and orb. The orb is also AILI's presence inside the Stage (no talking-head professor).
- **No mascot in scope** [Lucky, Oct 9]: the fox in the mockups was a design reference only. Do not build, animate or reference a mascot.
- Production: vector master (SVG), flat and monochrome versions, and a simplified small-size/favicon mark (the thin orbit disappears at small sizes). The mockups look like concept renders: if any artwork was AI-generated, check the tool's commercial terms and protectability. Trademark clearance for "AILI" is not confirmed.

## 6. Surfaces and scope [Decision]
1. **Landing** — real V1 screenshots only; no claims about unbuilt modules.
2. **Home/Resume** — resume the last session, start a new goal; not a dashboard.
3. **The two stages** — Learn stage and Build Workbench (see `aili-stage-layout.md`).
- The mockups show more than V1 (robotic hand anatomy, "AI & Machine Learning" chip, Whiteboard, Research, Search). **Robotics is the only module.** Unbuilt items are omitted or labelled "coming"; no mode dashboards.
- Prepared vs live content is always visibly labelled.

## 7. Motion [Decision — Lucky's motion text not yet received]
UI transitions ~200–300 ms; spatial/camera transitions ~500–700 ms; easing ease-out; honour `prefers-reduced-motion`.

## 8. Implementation notes for Claude Code
- `design/tokens.css` (CSS variables, light + dark semantic tokens, not raw hex in components).
- Component states: default / hover / active / focus / disabled.
- Self-hosted fonts; SVG logo set; keep the brand images in the repo under `design/` (text docs can't hold images).

## 9. Still missing from Lucky's text
Typography, interface and motion-language sections (the pasted text stopped after the colour section). Defaults above stand until replaced.
