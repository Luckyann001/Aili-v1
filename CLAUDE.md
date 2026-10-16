# AILI — Claude Code project instructions

AILI (Artificial Intelligence Learning Interface) is an interactive learning-and-building environment. A person understands a complex technical topic through a one-on-one AI professor using 3D visuals, analogies, calculation and simulation, then is guided into building a real project. Core loop: **understand → visualize → experiment → reason → build.**

Stack and structure approved Oct 9 2026. M0 (foundations) is complete and merged locally into `main`.
**M1 paused Oct 11 2026 (not finished):** sign-in (slice 8), saved sessions and migration (slice 9), landing page polish, the waitlist and the registry database sync are deferred to the last stage (after M6, before M7, and before any public deployment); do not start them unless asked. **A real AI key may be used on Lucky's laptop only, never deployed and never on any hosting service, until the database stage** (decided Oct 12 2026). **M2 (engine) is complete. M3 (live professor) is next:** follow `docs/m3-plan.md`, one slice at a time.

## Scope (do not exceed)
- AILI is a **platform**; **robotics is the only module** for now. No other subjects, no whiteboard, no search, no mascot, no AI/ML module, no AR/VR (design for it later, build nothing now).
- Two intents: **understand**, **build**, or both. Two stages on one shared engine: the **Learn stage** and the **Build Workbench**.
- Beta target: 20–30 invited users plus a waitlist. Honest labelling matters more than breadth.

## Read first (`docs/`) — source-of-truth order
1. `aili-professor-behavior-spec.md` — professor behavior, tests (explaining is a core job).
2. `aili-stage-layout.md` — Learn stage and Build Workbench layouts.
3. `aili-brand-design-language.md` — "Tactile Spatialism", palette, type, accessibility.
4. `aili-architecture.md` — registry, solvers, validator, planner, robotics concept graph, reference library. Its lines "explanation is a fallback", "living knot presence" and "one stage" are **superseded** by 1–3.
5. `aili-visuals-curriculum-billing.md` — assets, AI-visual tiers, billing.
6. `aili-milestones-and-checklist.md` — build order M0–M8. Do one item at a time.
7. `00-master-prompt.md` — original constraints. Images in `design/`.
If docs conflict, follow the lower number and tell me.

## Stack (approved Oct 9 2026)
- **Next.js 16 App Router + TypeScript**, npm workspaces: `apps/web`, `packages/schemas` (Zod), `packages/solvers`, `packages/engine` (validator, planner, shortlist from M2).
- **React Three Fiber 9 + drei** (three.js) for 3D; **Zustand** for client state; **Zod** for every schema; **Vitest** for tests.
- **CSS Modules + `design/tokens.css`** (no Tailwind); fonts self-hosted via `@fontsource-variable/newsreader` and `@fontsource-variable/inter`.
- **Supabase** (Postgres, auth); **Vercel**.
- **Turn events over SSE, plus a POST interrupt endpoint** carrying the request ID and state revision (Vercel serverless functions cannot hold WebSockets open).
- **Solvers are plain TypeScript, SI units only inside**, with the unit in every field name (`arm_length_m`); conversions only at the edges; tests against worked textbook examples. Add a Python service only if a heavy simulation needs it.
- Content (concepts, assets, simulations, analogies, readings, project templates) is versioned JSON/YAML in git, synced to Postgres. Provider and model are configuration, never hard-coded.

## Setup and commands
- **Node 22 is required** (`.nvmrc`); check with `node -v`.
- `npm install` · `npm run dev` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` (all from the repo root).
- `npm run test:e2e`: Playwright with the installed Google Chrome against a production build on port 3200 (desktop and phone viewports, axe accessibility scans).
- `npm run dev:lan`: dev server reachable from a phone on the same Wi-Fi at `http://<laptop IP>:3000` (`hostname -I`, first address). The laptop firewall (ufw) must allow it, for the home network only: `sudo ufw allow from 192.168.100.0/24 to any port 3000 proto tcp` (remove with `sudo ufw delete allow from 192.168.100.0/24 to any port 3000 proto tcp`).
- `npm run test:e2e:nodrafts`: a real production build **without** the drafts flag (its own folder `.next-nodrafts`, port 3300, flag pinned to 0). Checks draft scenes stay hidden, the lesson says it isn't available yet, and `/preview` is not in production.
- `npm run dev:demo` (founder demo mode, decided Oct 16 2026): the live dev server (as `dev:live`) with `AILI_CONTENT_MODE=founder-demo` set in the script's own environment (never `.env.local` or a committed file). The page labels the published fixture scene and asset a live turn puts on stage from their own manifests, and shows that scene without the drafts flag; "Prepared · reviewed by the founder, not an expert reviewer" only when both the scene and its asset carry a founder review record, otherwise "Prepared · not reviewed". The professor's shortlist does not change (published only). The mode is honoured only where the fixture registry is allowed (dev live server, test builds); production builds ignore it (`npm run test:e2e:nodrafts` checks). `npm run test:e2e:demo`: its labels on the recorded live path in a test build (port 3400).
- `AILI_PERF=1 npm run test:e2e -- perf`: emulated performance run (6× CPU slowdown, Slow 4G, phone viewport) and JS size per route. An emulation on the laptop, not a real phone.
- **Testing flags (non-secret, build-time; dev `.env.local` and the main e2e build only; never set in production):** `NEXT_PUBLIC_AILI_DEMO_TOOLS=1` enables `?demo=1` (Demo controls, performance readout); `NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1` enables the fake-director demo (`/api/turn`, `/api/turn/interrupt`, test fixtures from `content/robotics/test-fixtures/`). Without them, as in production, `?demo=1` does nothing, both routes return 404 and no fixture file is in the build (`npm run test:e2e:nodrafts` checks this).
- `/preview` is the design check page (tokens, type, logos, 3D renderer). Development only: production builds return "not found" unless `AILI_ENABLE_PREVIEW=1` is set at build time (the main e2e build sets it).
- Next 16 allows only **one dev server per project** at a time.
- Next 16 differs from older versions: read `node_modules/next/dist/docs/` before writing Next.js code (see `apps/web/AGENTS.md`).

## Product rules
**Professor (live AI) — see the behavior spec.**
- It must *explain* concepts: probe briefly → learner commits → explain (intuition, mechanism, equation with assumptions, visual, analogy) → check. True beginners get a short explanation first. At most one probe before an explanation.
- Postures: Answer / Learning / Build. Moves: probe, explain, challenge, demand_evidence, debate, assign, teach_back, review, answer, hold. Professor behavior is the default during learning time, not every interaction.
- Pacing: one open question at a time; never two questions in a row without giving something back; challenge budget one in three turns except safety errors; help ladder for problems (not for withholding concepts).
- Anti-sycophancy: hold a correct position under pushback without new evidence; update on valid evidence; no flattery.
- Assign readings only from the verified library; never invent books, chapters, pages, videos or timestamps. Teach-back is graded against the human-written guide, not the source text. Never declare mastery from one answer.
- Presence is the logo's orb. No talking-head professor, no mascot.

**Director contract (engine).** The LLM proposes a structured response (move, narration, actions, calc requests, evidence, prompt, assumptions, limitations). A **validator** checks IDs exist, values in bounds, citations exist, pedagogy rules, and rejects any **hard-coded engineering number** in narration (use placeholders like `{{torque_nm}}`). **All numbers come from deterministic solvers.** The arm's own mass must be included in torque models. The professor only sees a **shortlist** of *published* capabilities retrieved by concept and level. Per turn: shortlist → director → validate → solver → compile → events (SSE; interrupt via POST) → client renders locally. Stale actions are invalidated via sequence numbers/request IDs/state revision (interrupt must stop audio and queued actions immediately). On any failure keep the last valid state and say so plainly.

**Capability registry.** Items: assets/anatomy, animations, simulations, solvers, analogies, readings/evidence, project templates. Each declares `teaches` (concept IDs), `fidelity` (verified / simplified teaching / illustrative), `version`, `review_status` (draft / reviewed / published), `provenance`. **The AI never publishes** — draft → automated checks → human expert review → publish. **Demo exception (decided Oct 16 2026):** a founder review (`review.role: "founder"`) may stand in for the expert review on a demo item only; it is labelled "Prepared · reviewed by the founder, not an expert reviewer" and is never presented as expert review. Labels come from one function (`contentLabel` in `packages/schemas/src/labels.ts`), derived from fidelity, provenance and the review record; AI composition is named only when the provenance says so. Visual tiers: T0 library asset; T1 AI-composed from library primitives (label "Illustrative (AI-composed)"); T2 AI-generated 2D diagram; T3 AI 3D mesh is **offline authoring only**. An animation is not a simulation. No invented anatomy of a named real product.

**Anatomy is core to the Learn stage:** real visual anatomy of the parts being taught, either measured or properly sourced, with provenance and an honest label (illustrative/generic vs measured), never a named product's internals invented.
**Learn stage:** one scene at a time; orbit/select/label/exploded view; temporary inspector with sliders (units + bounds); voice button with idle/listening/thinking/speaking/error + **interrupt**; text box; captions overlay; right text-explanation panel (usually closed); Library drawer of verified readings. Voice is optional; start with browser speech; provider behind config.
**Build Workbench:** Blender-style: parts/outliner + catalog (left), viewport (centre), properties + Guide/Tests (right), checks strip (torque margin, mass), timeline/log (versions, tests, measurements). Source of truth is `design.json` (parts, parameters with units, connections, milestones, tests, versions; undo/redo). **Parametric first** (sliders/dropdowns), not drag-and-snap. Aili proposes changes; the learner accepts or rejects — no silent edits. Phones are view-only in V1. Label "simulation only; hardware untested" until a real measurement is logged. Learn↔Build handoff and side quests per the layout doc. Milestones declare `requires_concepts` with evidence-or-waiver readiness (safety-critical waivers need explicit acknowledgement).
**Study planner:** goal, baseline, time, intent → editable table of contents built and **validated by code** from the concept graph (prerequisites first, every unit has a checkpoint, IDs exist).
**Robotics coverage levels:** lab / guided / discussion. MVP labs: servo torque (statics), inside the servo/gearing, feedback control. Say honestly when something is not supported and log it as demand.

## Honesty and safety
- Never claim verified live behavior you did not run; label **prepared/demo vs live** content visibly. Never invent sources, part numbers, prices, availability or specs. Say "I can't verify that" when true.
- Battery, mains, motor and drone topics: conservative wording, datasheet citations, explicit acknowledgements.
- Frontier Lab cards: dated, primary-source linked, manufacturer claim separated from Aili's simplified model; never auto-published; not a live news feed.
- Do not use the word "investigation" as a product label. Unbuilt features are omitted or marked "coming".

## Design (see brand doc)
Palette: Canvas #F5F1EB, Deep canvas #EBE4DA, Surface #FFFDFA, Ink #282724, Copper #C96543, Strong copper #A7482F, Sage #83957E, Sky #8DAEB9, Gold #C99A56, Plum #917383. Create `design/tokens.css` with **light and dark semantic tokens** (dark is its own set, not an inversion).
- Primary buttons: Strong copper background + Surface label (passes 4.5:1). Sage/Sky/Gold/Plum are fills/icons/3D materials only; text on them is Ink. Never as text on Canvas.
- Meaning never by colour alone (icon + label + shape). Safety/warning has its own pattern.
- Type: self-hosted **Newsreader** (display) + **Inter** (UI). Avoid generic neon-AI graphics, crowded dashboards, glassmorphism, decoration without purpose, rainbow UI.
- Motion: UI 200–300 ms, spatial 500–700 ms; honour `prefers-reduced-motion` with a still alternative.
- Accessibility: keyboard for everything, captions always available, labelled landmarks, ≥44 px touch targets, spacebar shortcuts never interfere with typing.
- Performance: Test on a low-end Android phone (Itel A667L, Android 14), judging speed on a production build, not the dev server; low-poly assets with size budgets, lazy loading, a fallback viewer; scenes in real units (metres).
- Token rules as built: brand doc §3a. Plum takes large text only. The decorative border is for dividers only; controls use border-strong. Pass / Warn / Fail each have a distinct icon shape plus the word. The fail tint never goes on buttons.
- The app uses the `*-outlined` logos, and `logo-horizontal-compact.svg` in navigation.
- The docs in `docs/` are the source of truth; propose any change to them before making it.

## Security and secrets
Provider keys and Supabase service-role credentials are **server-only**, in `.env.local`/host settings; `.env*` in `.gitignore`; never commit, print or log them; never ask me to paste secrets into chat. Validate all inputs; sanitize any AI-produced SVG/scene description; never run model-written code in the live app. Learner memory: keep what they say, what was observed, what Aili infers and explicit preferences separate; let learners inspect, correct and delete it. Check consent and data-protection requirements (Kenya and the data location) before beta.

## Money
Billing is **unresolved**: no forced paywall or trial tollbooth. Meter every session (tokens in/out, voice, hosting) from config-held unit prices; cap the free tier by cost; global kill switch. Max two runtime models: a professor model and a cheap router (provider/model in config; bake-off planned). Top-tier models are for authoring only.

## Working method
- Work on a **branch**; **never merge into main**. No destructive resets, unrequested migrations, paid provisioning, publishing, or deleting without my approval.
- Plan first and wait for approval; one milestone item at a time; small commits; run tests/lint/typecheck before saying done.
- Write tests for solvers (worked examples), the validator, the planner and professor session tests (17 in the behavior spec).
- Report plainly: what was built, what was verified (and how), what was not, and any doc conflicts. Do not claim access to anything you can't reach.
- I use a limited Claude plan: keep prompts and file reads focused; don't spawn parallel work unless asked.
- Keep each task small because the Claude plan has limited prompts; if a task would take more than one session, split it and tell me.
- Keep this file current; if a decision changes, propose the edit.

## Never do (unless I ask)
- Push, add a remote, or run `gh repo create`.
- Merge into `main`.
- Run migrations, provision paid services, publish anything, or delete without approval.
- Commit, open, print or log `.env*` files.
- Edit files in `design/logo/` (the app uses copies; new variants go beside the originals).
- Say something works without running it, or hide a failing test.
- Kill processes I did not start. Never use broad `pkill`; only stop a server Claude started, by its own PID.
