# AILI — Brand Identity & Design Language V1 ("Tactile Spatialism")

Status: v0.3, Oct 9 2026 (v0.3 adds §3a, the token rules as built in M0). Labels: **[Lucky]** specified by Lucky, **[Inferred]** read from the images, **[Decision]** fixed by the technical engineer in line with AILI's direction (Lucky delegated these).

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
- **Plum restriction** [Lucky, Oct 9]: Ink on Plum is 3.55:1, so Plum carries icons, fills and **large text only** (≥24 px, or ≥18.66 px bold). No normal-size text on Plum.
- Meaning is never colour-only: add icon, label or shape (copper vs sage is hard for some colour-blind users).
- Safety/warning states use a dedicated pattern (warning icon + "Safety" label + heavier border), not copper alone.
- Dark-mode tokens are authored separately and re-checked with the same ratios before shipping.
- All motion honours `prefers-reduced-motion`; every animation has a still alternative.

## 3a. Token rules as built (M0) [Lucky approved, Oct 9]
Source of truth: `design/tokens.css`. Components use semantic `--aili-*` tokens only, never raw hex. Every allowed text/background pair is tested in `apps/web/src/design/contrast.test.ts` (4.5:1 normal text; 3:1 large text, icons, focus rings and control boundaries). A new pair must be added to that list before it is used.

| Token | Light | Dark |
|---|---|---|
| bg (Canvas) | #F5F1EB | #1C1A17 |
| bg-recessed (stage well) | #EBE4DA | #141210 |
| surface (panels) | #FFFDFA | #262320 |
| text | #282724 | #F2ECE3 |
| text-muted | #5C574F | #B5ACA0 |
| link | #A7482F | #E3987A |
| action-bg / hover / pressed | #A7482F / #8F3C26 / #7A3320 | #D9805F / #E3987A / #E8A68B |
| action-text | #FFFDFA | #1C1A17 |
| accent | #C96543 | #D9805F |
| focus-ring | #C96543 | #E3987A |
| border (decorative) / border-strong | #DDD4C7 / #847A6E | #3A3631 / #857A6D |
| fill-explore / technical / discovery / expressive | Sage / Sky / Gold / Plum | same |
| on-fill | #282724 | #282724 |
| status pass / warn / fail bg | #DCE3D8 / #F2E3C8 / #F3DCD2 | #25302A / #3A3122 / #3A2A22 |
| status pass / warn / fail border | Sage / Gold / Strong copper | Sage / Gold / #D9805F |
| safety bg + border (3 px) | #F2E3C8 + #282724 | #3A3122 + #F2ECE3 |

- **Dark-mode derived shades:** #D9805F, #E3987A and #E8A68B are dark-mode tokens derived from Copper (not palette colours). In dark mode the primary button is #D9805F with a dark (#1C1A17) label, because Strong copper on the dark canvas has a weak edge (about 2.5:1).
- **Status states:** pass, warn and fail each use a **distinct icon shape** and the **words Pass / Warn / Fail**; colour only supports them. Fail is a pale copper tint with a Strong-copper border. The fail tint (`--aili-status-fail-bg`) is **never** used on anything that looks like a button or link.
- **Borders:** the decorative border (#DDD4C7 light / #3A3631 dark) is for non-essential dividers only. Inputs, controls and anything the learner must find use `--aili-border-strong` (3:1). Enforced where practical by `apps/web/src/design/token-usage.test.ts`, which scans the app's CSS.
- **Safety:** warning icon + "Safety" label + 3 px border in text colour, on the safety background.

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
