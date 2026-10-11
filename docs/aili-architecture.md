# Aili: Architecture and Robotics Curriculum Structure (v0.2)

**Status:** design document for a **fresh build** (no existing code). Nothing here is implemented. v0.1 written 2026-10-09 with Lucky; v0.2 same day aligns it with the behavior spec v0.2, the two-stage decision and the fresh-build decision.
**Reference prototype:** a standalone servo-torque page exists as a visual reference only: https://claude.ai/artifact/APXz97QhRWZ6aGTVMj3cbb (rule-based "prepared lessons", no live AI; the torque numbers come from a real deterministic solver). Its palette is superseded by the brand doc.
**Companions:** `aili-professor-behavior-spec.md`, `aili-stage-layout.md`, `aili-brand-design-language.md`, `aili-visuals-curriculum-billing.md`, `aili-milestones-and-checklist.md`.

---

## 1. Decisions so far

- **Aili is a platform; robotics is its first module** (changed 2026-10-07). Only robotics has content.
- **Fresh build, two stages, one shared engine** (2026-10-09): a **Learn stage** (Aili directs a scripted scene for one concept) and a **Build Workbench** (the learner directs a multi-part design; Aili reviews). See `aili-stage-layout.md`.
- **Two intents, one platform:** people come to understand, to build, or both (section 8).
- **Core learning structure:** Aili **explains concepts clearly** and also questions, challenges, asks for evidence, debates, assigns reading with teach-back, and guides the learner's project. Questions and predictions exist to make the explanation land, not to replace it (behavior spec A1/A1a). Professor behavior applies during learning time, not every interaction.
- **Runtime AI, at most two models:** a "professor" (mid-tier reasoning model that returns structured responses) and a cheap "router" (classification, short tasks). Provider and model are configuration, never hardcoded.
  - Snapshot from provider docs on 2026-10-06 (prices change, re-verify): OpenAI GPT-6.1 Sol ($2 in / $10 out per million tokens) and GPT-6 Luna ($0.10 / $0.50); Claude Sonnet 5.5 ($2 / $10).
  - Starting suggestion: GPT-6.1 Sol + GPT-6 Luna (one vendor). Run a head-to-head test against Claude Sonnet 5.5 on about 30 scripted learner scenarios, judged on validator pass rate, latency and cost per session. Include "confident but wrong learner" scenarios.
  - Voice is a service layer, not a counted model. Start with browser speech; add a provider's streaming voice once the core loop is proven.
  - Top-tier models (Claude Opus 5.5 / Fable 5.1, GPT-6 Astra) are for authoring modules, never per learner.
- **The AI directs a library; it does not invent physics, assets or numbers.**
- **Numbers come only from solvers.** Narration uses placeholders (for example `{{torque_nm}}`), and the validator rejects any response containing a hard-coded engineering value.
- **Presence and characters:** the logo's orb is Aili's presence (no talking-head professor, **no mascot**). "Characters" are a small cast of object figures used inside analogies, in a restrained geometric style, each carrying an explicit mapping to the real concept.
- **Prepared/demo behavior must be visibly distinct from live-AI behavior.**
- **Beta plan:** 20 to 30 hand-recruited users plus a waitlist, then take the results to investors and accelerators. Deliver what is ready; do not cut scope to a deadline.

**Open decisions:** billing model, provider bake-off result, voice provider, hosting region and consent wording for beta data, final stack confirmation (section 3).

---

## 2. Principles

1. Concepts are the glue. Every asset, simulation, analogy, reading and project points to concept IDs.
2. Deterministic where it matters: calculations, units, bounds.
3. Honest labelling: each model states its fidelity (verified model, simplified teaching model, illustrative only).
4. AI proposes, validators and humans approve. Nothing the AI writes enters the live library without review.
5. Fail clearly and keep the last valid state.
6. Measure learning and project outcomes, not time on page.

---

## 3. Backend layers

| Layer | Contains |
|---|---|
| Teaching | Professor (director model), study planner, router, output validator |
| Capability | Registry of assets, animations, simulations, solvers, analogies, evidence, projects, parts catalog |
| Learner | Sessions, turns, predictions, assignments, teach-backs, notes, project dossier and designs, memory |

Supporting services: solver service (deterministic), evidence service (retrieval from the curated library), voice adapter (speech out and in, provider behind a config), telemetry and cost accounting.

**Proposed stack (confirm or counter-propose with reasons; prefer the simpler option):** Next.js + TypeScript; React Three Fiber; Postgres on Supabase (pgvector optional); object storage for 3D files; Vercel. **Solvers in TypeScript in a shared package**, so the same code runs in the browser (instant sliders) and on the server (validation), with unit checks and tests against worked textbook examples. Add a Python/FastAPI service (NumPy, SymPy) only if a heavy simulation or ROS needs it. Content definitions live as versioned JSON or YAML in git and sync into the database, so every change is a reviewable diff. Provider keys and service-role credentials stay server-only.

---

## 4. Capability registry

| Capability | Stored as | Must declare |
|---|---|---|
| 3D asset and anatomy | 3D model file with named parts, plus a card per part | part IDs, function, fidelity, license, source |
| Animation | named clip, or camera / ghost / exploded-view preset | target part IDs, parameters, duration, a reduced-motion alternative |
| Simulation | definition linked to a solver | inputs with units and bounds, outputs, failure states, assumptions, exclusions, fidelity |
| Solver | versioned code | tests against worked textbook examples, unit checks |
| Analogy | small scene plus role-to-concept mapping | where it breaks down, level, concepts taught |
| Reading and evidence | source plus reading item plus guide | see section 11 |
| Project template | milestones | concepts used, parts categories, risks, tests, safety notes |
| Part (Workbench catalog) | datasheet-sourced spec card plus asset | specs with source, fidelity, license; never invented prices or availability |

An anatomy is not a separate system, only a labeled view of an asset.

Every item carries `teaches` (concept IDs), `fidelity`, `version` and `review_status` (draft, reviewed, published). The professor only ever sees published items.

### Example: concept node

```json
{
  "id": "mech.torque.static",
  "domain": "mechanics",
  "title": "Static torque about a joint",
  "summary": "The twist a joint must resist to hold a load still: force times perpendicular distance, summed over every load.",
  "levels": {
    "L1": "Why holding a weight far from your body is harder.",
    "L2": "tau = r x F, the moment arm, and including the arm's own mass.",
    "L3": "Torque margin, duty cycle and dynamic loads, which the static model does not cover."
  },
  "prerequisites": ["mech.force", "mech.moment-arm"],
  "coverage": "lab",
  "capabilities": ["sim.servo-static-load", "analogy.bag-at-arm-length", "asset.servo-camera-arm"],
  "readings": ["read.statics-moments-intro"],
  "misconceptions": [
    "Leaving out the arm's own mass",
    "Treating the rated stall torque as safe continuous capacity"
  ],
  "checks": [
    { "type": "predict", "id": "pred.double-reach" },
    { "type": "transfer", "id": "xfer.tilted-20cm" }
  ],
  "status": "draft"
}
```

### Example: simulation manifest

Bounds below come from the reference prototype. Static model: `tau = (m_p * l + 0.5 * lambda * l^2) * g * cos(theta)`.

```json
{
  "id": "sim.servo-static-load",
  "type": "simulation",
  "version": "0.1.0",
  "teaches": ["mech.torque.static"],
  "solver": { "id": "solver.static-torque-single-link", "version": "0.1.0" },
  "inputs": {
    "arm_length_m": { "min": 0.05, "max": 0.5, "unit": "m" },
    "payload_kg": { "min": 0.0, "max": 1.5, "unit": "kg" },
    "arm_kg_per_m": { "min": 0.1, "max": 1.0, "unit": "kg/m" },
    "angle_deg": { "min": 0, "max": 90, "unit": "deg" }
  },
  "outputs": ["torque_nm", "torque_kgcm", "share_of_rating"],
  "assumptions": ["static hold only", "uniform bar", "payload at the tip", "angle measured above horizontal"],
  "excludes": ["acceleration", "friction", "gear play", "structural stress", "temperature and duty cycle", "control stability"],
  "fidelity": "verified",
  "review_status": "draft"
}
```

### Example: analogy manifest

```json
{
  "id": "analogy.bag-at-arm-length",
  "type": "analogy",
  "version": "0.1.0",
  "teaches": ["mech.torque.static"],
  "levels": ["L1"],
  "cast": ["figure.carrier", "prop.bag"],
  "mapping": [
    { "source": "shoulder", "target": "servo joint" },
    { "source": "bag", "target": "camera payload" },
    { "source": "reach", "target": "moment arm" }
  ],
  "breaks_down": "Muscles tire and heat differently from a servo, and a shoulder is not a gearbox. The analogy shows why distance matters, not how much torque a particular servo can give.",
  "followed_by": "sim.servo-static-load",
  "review_status": "draft"
}
```


### Solver: relative effort to hold a lever level [added M1 slice 4c, Oct 2026]
Used by the beginner lever analogy to drive an illustrative, unitless effort gauge (`packages/solvers/src/leverEffort.ts`; details in `packages/solvers/README.md`).
- **Assumptions:** rigid, uniform lever (its own mass acts at its middle); static case (held still and level); the hand grips one end, which is the pivot; the weight is a point mass; gravity straight down; friction and bending ignored.
- **Model:** moment about the hand `M(d) = g · (m_weight · d + m_lever · L / 2)`; relative effort `= M(d) / M(L)`, so 1 with the weight at the far end. The lever's own mass is always included, so effort never reaches zero.
- **Does not cover:** endurance, fatigue, heat, dynamic loads or any rating. It compares positions; it is not a sizing calculation.
- **Worked example (in the test):** lever 0.30 m and 0.05 kg, weight 0.20 kg at 0.10 m → 0.0275 / 0.0675 = 0.407.

---

## 5. Per-turn request flow

1. The client sends the scene state, the learner's input, selected object and context, with a state revision number.
2. The server retrieves a **shortlist** of relevant published capabilities, by concept and level. The director sees only this shortlist, so prompts stay small and it can only choose real items.
3. The director returns a structured plan (example below).
4. The **validator** checks that IDs exist, values are in bounds, citations exist, narration contains no hard-coded engineering numbers, and pedagogy rules hold (for example, no more than one open question).
5. The solver runs any calculation requests.
6. The server compiles narration, scene actions, equations, evidence and the learner prompt, and sends events to the client over WebSocket or SSE. The client renders and interpolates locally.
7. State is saved. A newer learner input (including an interrupt) invalidates stale queued narration and actions (sequence numbers, request IDs, idempotency).

```json
{
  "request_id": "req_0142",
  "state_rev": 14,
  "move": "challenge",
  "narration": [
    { "id": "n1", "text": "You said a bigger servo will do. Bigger needs a number: datasheets give torque at a stated supply voltage." }
  ],
  "actions": [ { "type": "focus", "object": "servo.horn" } ],
  "calc_requests": [],
  "evidence": ["ev.datasheet-stall-torque"],
  "prompt": { "text": "Which datasheet figure are you comparing, and at what voltage?", "chips": ["I have a datasheet", "Not sure where to look"] },
  "assumptions": [],
  "limitations": []
}
```

The only question is in `prompt`; narration explains and never asks (one open question, behavior spec A5). Fidelity uses the schema's values: `verified`, `simplified_teaching`, `illustrative`. [Example corrected Oct 11 2026.]

Failure rule: on any validation, provider or solver failure, keep the last valid state and show a clear message. Never present prepared content as a live model response.

---

## 6. Authoring pipeline (separate from the live app)

1. **Draft:** you and Claude Code (or an AI-assisted tool) write the manifest, asset and solver.
2. **Automated checks:** schema, part IDs, bounds, solver tests against worked examples, file size and polygon limits, license metadata.
3. **Expert review:** a person who knows the field checks the model, the labels and the claims.
4. **Publish** as a new version. The AI can propose items and can never publish.

---

## 7. Learner state and memory

Tables: users, preferences, sessions, turns (with `move`), scene state, inputs, calculation runs, predictions (guess, result), reading assignments, teach-backs, notes, project dossier, designs (`design.json` versions), capability versions, metered usage.

Keep four things separate: what the learner says about themselves, what was observed, what Aili infers, and explicit preferences. Let learners inspect, correct and delete memory. Never turn one wrong answer into a permanent judgment of ability. Learner notes belong to the learner; AI suggestions never silently become their conclusions.

---

## 8. Two intents, one platform (and two stages)

Aili serves people who come to **understand** something, people who come to **build** something (a mini robot, a cyberdeck), and people who do both. They share one engine, one concept graph, one learner state and one artifact store. They differ in where they start, how the professor behaves, which stage they spend most time in, and what they leave with.

| | Understand | Build | Both |
|---|---|---|---|
| Starts from | a topic or question | a thing to make | a thing to make and understand |
| Plan is built from | a path through the concept graph | a project template and requirements | the project as the spine, with concept detours as side quests |
| Professor posture | learning posture: explain, probe, challenge, assign, teach-back | build posture: requirements, design review, just-in-time concepts, safety | build posture, switching to learning posture at concept gates |
| Main stage | Learn stage | Build Workbench | both |
| Main artifact | reasoning record and evidence of understanding | project dossier and `design.json` | both |
| Success signal | transfer to a new situation | milestones reached, tests passed, measurements logged | both |

**Rules**
- Intent is inferred from the first message, confirmed with one tap, stored on the goal (`intent`), and changeable at any time.
- **Two stages, not dashboards.** The Learn stage and the Build Workbench are separate layouts on one engine; the learner moves between them with "Take this to the workbench" (copies lab settings into a design) and side quests (a failing check or a milestone's `requires_concepts` opens the relevant lab, then returns).
- Milestones declare `requires_concepts`. A milestone is **ready** when the learner's evidence meets the threshold, or when the learner waives it with a reason that is recorded. Waivers on safety-critical concepts require an explicit acknowledgement.
- **Need-to-know mode** for builders who want to skip theory: give the minimum needed to decide safely, with sources, and offer the deeper path later.
- **Capstone for learners:** at the end of a concept path, offer an optional small project.
- **Build assistance:** requirements interview, comparison of two or three alternative designs, solvers used as calculators (torque margin now; power budget later), parts checks against datasheet evidence the learner supplies or a verified catalog (never invented availability or prices), a structure and wiring outline, a test plan, a risk register with a pre-mortem, a troubleshooting flow (symptom, ranked hypotheses, tests), and a model-versus-reality measurement log.
- **Limits:** Aili cannot verify a physical build. Label projects "simulation only; hardware untested" until the learner logs real measurements.
- **Other subjects (such as cyberdecks):** the planner, dossier, library and professor are domain-agnostic. A new subject still needs its own concept graph, solvers, assets, readings and project templates. Until then it gets guided or discussion coverage only. Do not promise cyberdeck labs in the MVP.
- **Commercial hypothesis, to test, not decided:** understanding is the free entry; guided building (project packs, saved projects) carries the paid value.

```json
{
  "plan_id": "plan.001",
  "intent": "both",
  "goal": "Build a camera pan-tilt mount and understand why servo size matters",
  "scope": { "in": ["servo load", "feedback basics", "parts selection"], "out": ["inverse kinematics", "vision"] },
  "units": [
    { "id": "u1", "kind": "concept", "concepts": ["mech.torque.static"],
      "why": "Needed to size the servo",
      "activities": ["challenge", "lab:sim.servo-static-load", "teachback"],
      "est_minutes": 30, "checkpoint": "xfer.tilted-20cm" },
    { "id": "u2", "kind": "build", "milestone": "ms.requirements",
      "requires_concepts": [], "activities": ["requirements-interview"], "est_minutes": 20 },
    { "id": "u3", "kind": "build", "milestone": "ms.servo-selection",
      "requires_concepts": ["mech.torque.static"], "readiness": "evidence-or-waiver", "est_minutes": 30 }
  ],
  "note": "Time figures are estimates and adjust with use."
}
```

---

## 9. Study planner

Input: goal, baseline, time available, desired outcome (understand, build, career), constraints (budget, hardware access).

1. Ask two or three clarifying questions.
2. Map the goal onto target concepts, and a project if the intent includes building.
3. Run a few probes to find missing prerequisites.
4. Build an ordered path, shown as an **editable table of contents**: for each unit, the concepts, why it is there, the activities (lab, reading, challenge, teach-back, build step), an estimated time and a checkpoint. The learner can reorder or skip.
5. Adapt as evidence arrives.

The model proposes; **code builds and validates the plan from the graph**: prerequisites come first, every unit has a checkpoint, every concept ID exists, and milestones link to concepts. Every unit is tagged lab, guided or discussion-only so the learner can see what is verified. For a subject with no module yet, the plan is a provisional outline and says so.

---

## 10. Robotics concept structure

Model robotics as a graph of concepts, not a list. Each concept has prerequisites, three levels (L1 intuition, L2 quantitative, L3 design and limits), a coverage tag and links to capabilities and readings. Cross-cutting axes: robot type (arm, wheeled, legged, aerial), skill level, activity type.

**Draft domains, to be reviewed by a working roboticist** (compare against a university syllabus and a standard text such as Lynch and Park's *Modern Robotics*):

| Domain | Example topics | MVP coverage |
|---|---|---|
| Systems view | sense-think-act, autonomy levels, safety and ethics | guided |
| Mechanics and statics | forces, moments, torque, equilibrium, structures | **lab** |
| Kinematics | frames, degrees of freedom, forward and inverse, workspace | discussion |
| Dynamics | inertia, friction, backlash, payload, energy | discussion |
| Actuation | DC, brushless, stepper, servo, gearing, drivers | **lab** |
| Power and electronics | batteries, motor drivers, microcontrollers, buses, wiring | discussion |
| Sensing | encoders, IMUs, ranging, cameras, force, noise | guided |
| Perception | vision, localization, mapping, sensor fusion | discussion |
| Control | open and closed loop, PID, stability, tracking | **lab** |
| Planning and navigation | path planning, collision, SLAM | discussion |
| Software | programming, ROS 2, simulation tools, state machines | discussion |
| Manipulation | grasping, end effectors | discussion |
| Learning in robotics | imitation, reinforcement learning, vision-language-action models | discussion |
| Design and testing | requirements, CAD, integration, reliability, failure analysis | guided |
| Frontier Lab | current robots and research | curated cards |

**Coverage levels:** *lab* (hands-on, tested solver, reviewed), *guided* (professor explains with the labeled robot and clearly marked illustrative shapes, no verified model), *discussion* (text and sources only, with an honest "cannot simulate this yet"). The questions learners ask at the guided and discussion levels are the demand signal for which lab to build next.

**STEM project templates**
- Beginner: servo camera mount or pan-tilt, line follower, obstacle-avoiding rover, phone-controlled car.
- Intermediate: 2-joint arm, self-balancing robot, camera-tracking pan-tilt, gripper, maze solver.
- Advanced: arm with inverse kinematics, ROS 2 mobile robot with mapping, pick-and-place with vision, drone.

```json
{
  "id": "proj.pan-tilt-camera",
  "level": "beginner",
  "domain_tags": ["mechanics", "actuation", "control"],
  "milestones": [
    { "id": "ms.requirements", "title": "Define requirements", "outputs": ["requirements list"], "requires_concepts": [] },
    { "id": "ms.servo-selection", "title": "Choose and check a servo", "outputs": ["torque margin", "parts list"],
      "requires_concepts": ["mech.torque.static"], "solvers": ["solver.static-torque-single-link"] },
    { "id": "ms.test-plan", "title": "Write the test plan", "outputs": ["test plan", "risk list"], "requires_concepts": [] }
  ],
  "parts_categories": ["servo", "controller board", "camera", "mount", "power supply"],
  "risks": ["servo stalls under load", "supply cannot deliver the stall current"],
  "safety_notes": ["moving parts can pinch", "disconnect power before wiring changes"],
  "measurement_points": [
    { "id": "mp.max-payload-hold", "compare_with_model": "sim.servo-static-load" }
  ],
  "review_status": "draft"
}
```

Each template provides requirements, concepts used, parts categories, risks, **safety notes** (lithium batteries, moving parts, drone regulations), a test plan and measurement points where the learner compares the model with reality.

---

## 11. Reference library

Store two things.

**Source:** type (book, course, video, paper, datasheet, documentation), title, authors or channel, edition or date, URL or ISBN, license and rights, free or paid, reading level, language, who verified it and when.

**Reading item:** a specific section, chapter or timestamp range, with concept IDs, level, purpose (intro, deepen, reference, lab), estimated minutes, alternatives, and a human-written **guide**: key claims, common misconceptions, teach-back prompts and an application question.

```json
{
  "source": {
    "id": "src.statics-textbook-seed",
    "type": "book",
    "title": "Engineering Mechanics: Statics",
    "authors": ["Meriam", "Kraige"],
    "edition": "VERIFY",
    "access": "paid",
    "rights": "link out only; do not ingest the text",
    "url": null,
    "verified": { "by": null, "on": null }
  },
  "reading_item": {
    "id": "read.statics-moments-intro",
    "source_id": "src.statics-textbook-seed",
    "location": "VERIFY chapter or section with a human",
    "concepts": ["mech.moment-arm", "mech.torque.static"],
    "level": "L2",
    "purpose": "deepen",
    "est_minutes": 25,
    "alternatives": [],
    "guide": {
      "key_claims": ["Moment equals force times perpendicular distance"],
      "misconceptions": ["Using the full arm length instead of the perpendicular distance when the arm is tilted"],
      "teach_back_prompts": ["Explain why a tilted arm needs less holding torque"],
      "application_question": "A 25 cm arm tilts to 45 degrees. How does the holding torque change, and why?"
    },
    "status": "candidate"
  }
}
```

**Rules**
- **Link out; do not copy.** Do not ingest copyrighted books. For YouTube, link or use the official embed with timestamps. Open-licensed material may be quoted within its license.
- **Only verified items can be assigned.** The AI may suggest candidates into a review queue. A person checks that the link works and the content matches the claim.
- **Re-check regularly:** automated weekly link checks, and flags for items that look outdated.
- **Learner-added sources** are accepted and marked "unverified".
- **Teach-back uses the human-written guide, not the source text.** This keeps the system clear of copyright problems and keeps grading consistent.
- **Seed candidates to verify before adding** (from memory, not checked): Lynch and Park, *Modern Robotics* (reported to have a free online version and a course); Craig, *Introduction to Robotics: Mechanics and Control*; Siegwart and colleagues on autonomous mobile robots; Thrun, Burgard and Fox, *Probabilistic Robotics*; the official ROS 2 documentation. For the beta, 30 to 40 well-guided items are enough.

**Frontier Lab cards** use the same discipline: each card has a date, a source link, a label separating the manufacturer's claim from Aili's simplified model, and a link to the concept behind it. Verify each against a primary source before publishing. Nothing is auto-published, and the page says plainly it is not a live news feed. Research notes gathered so far: Boston Dynamics and Google DeepMind announced a Gemini Robotics partnership for Atlas on 2026-01-05 (Boston Dynamics blog); Google documents Gemini Robotics ER models as preview in its developer docs; a trade article lists SharpaWave as a 22-degree-of-freedom hand with fingertip tactile and torque sensors (secondary source, check the manufacturer). Other specifics from a roundup article (for example Atlas degree-of-freedom count) were **not** confirmed against the manufacturer and should not be published without a primary source.

---

## 12. Build order

See `aili-milestones-and-checklist.md` (M0 to M8). In short: foundations and tokens, app shell and Learn stage layout, engine (registry, solvers, validator), professor, the first lab end to end, the Build Workbench, more labs and library, beta readiness (instrumentation, consent, spend caps, waitlist), then the beta run. Beta instrumentation records predictions with the guess and the real result, labs finished, questions outside coverage, ratings, per-session cost, a one-week transfer question, plain disclosure of what is recorded and a way to delete data. Check consent requirements for Kenya and for wherever data is stored.

---

## 13. Risks and open questions

- **Content cost** is the real scaling limit. Every lab needs a model, a solver, assets, tests and review.
- **Retention in the middle of a build:** parts arrive late, wiring fails, and the simulation does not match the bench. The troubleshooting flow and the model-versus-reality log exist for this.
- **Reading assignments may not be completed.** Keep them short and offer alternatives; measure return rates.
- **Models that agree too easily** weaken a challenger. Test for it explicitly.
- **Safety:** build advice involving batteries, mains power, motors and drones needs conservative wording, datasheet citations and explicit acknowledgements. Get legal advice on disclaimers.
- **Defensibility:** tool calling and 3D rendering are easy to copy. The defensible parts are the verified module library, the reading guides, the project outcomes and learner trust.
- **Unproven demand:** three friends and one founder story are not market evidence. Aim for about 20 real conversations and the beta data before drawing conclusions.
- **Performance on mid-range phones and limited data** (see the stage layout doc).
