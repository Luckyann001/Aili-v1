# M4 plan: a true beginner's first lab, in 3D (servo torque, end to end)

> **Superseded as the MVP lesson (Oct 21 2026).** The MVP lesson is now the drone altitude PID lesson in
> `docs/lesson-drone-pid.md`. The servo slices built here stay working as a second lesson and backup demo;
> they are not extended further for now. The `ctl.*` concept IDs below are kept and used by the drone lesson,
> which adds `ctl.derivative` and `ctl.integral`.

**Status:** PLAN ONLY, for Lucky's approval. Nothing is built. **Date:** 14 Oct 2026.
**Branch:** `m1/learn-stage-shell` (local commits only). Read with `docs/aili-architecture.md` §9–11,
`docs/aili-visuals-curriculum-billing.md` §1–2 and §4, `docs/aili-stage-layout.md` §1, `docs/m3-report.md`.

**Vision (Lucky, 14 Oct 2026).** A true beginner with no knowledge is taught in an immersive 3D space:
first an **animated analogy** (a simple figure or object acting it out), then a **real-world look** at
the robotics part and how it connects (a generic servo and arm with named parts), then the
**calculation**. The professor explains each step, and **the visuals follow the explanation**.
Robotics only. AR/VR is designed for later (scenes in metres, named parts); nothing AR/VR is built.

**Effort unit:** one *session* is one Claude Code working session on Lucky's plan (a small slice with
tests). Estimates are rough; anything over one session is split into slices.

## Recommended order (each slice stops for Lucky)

| # | Slice | Effort | Why this order |
|---|---|---|---|
| 1 | Narration-timed stage actions (section 8) | 2 sessions | Every scene below depends on visuals following the words |
| 2 | Concept graph seed and validation (section 1) | 1 session | The planner, shortlist and scenes key off it |
| 3 | Servo + arm scene with solver-driven arrow and gauge (section 3a) | 2 sessions | The real-world look and the calculation |
| 4 | Analogy figure rig and the shopping-bag scene (section 2) | 2 sessions | The first thing a beginner sees |
| 5 | Second analogy (long wrench) | 1 session | Reuses the rig |
| 6 | Inside-the-servo gear scene, guided, no solver (section 3b) | 1–2 sessions | Shows how the servo connects |
| 7 | Study planner v1 and the beginner journey (section 5) | 2 sessions | Replaces the live-mode concept stand-in |
| 8 | Readings: entries for the guides Lucky writes (section 4) | 0.5 session, plus Lucky's writing | Lucky writes the guides; code only stores and checks them |
| 9 | Demo rehearsal: recorded e2e of the demo script (section 7) | 1 session | The approved script as a browser test |

**Total:** about 12–14 sessions. A third analogy (bicycle gears) and a gear-ratio solver are left for after M4.

---

## 1. The concept graph (about 40 concepts, 3 labs)

**Status of every concept below: draft, to be reviewed by a working roboticist** (architecture §10).
IDs follow the existing pattern (`mech.torque.static`). Prerequisites point upward in each table.
Coverage: **lab** (tested solver, reviewed), **guided** (explained with labelled generic models, no verified model),
**discussion** (text and sources only, with an honest "cannot simulate this yet").

**Systems view**
| ID | Concept | Prerequisites | Coverage |
|---|---|---|---|
| sys.what-a-robot-is | Sense, think, act | none | guided |
| sys.joint-and-link | Joints turn, links carry | sys.what-a-robot-is | guided |
| sys.safety-moving-parts | Moving parts pinch; power off before changes | sys.joint-and-link | guided (safety-critical) |

**Mechanics and statics (Lab 1: servo torque)**
| ID | Concept | Prerequisites | Coverage |
|---|---|---|---|
| mech.force | A push or pull | none | lab |
| mech.mass-vs-weight | Mass, and the weight gravity gives it | mech.force | lab |
| mech.pivot | A point things turn about | sys.joint-and-link | lab |
| mech.moment-arm | Distance from the pivot (exists) | mech.pivot | lab |
| mech.torque.static | Torque needed to hold still (exists) | mech.moment-arm, mech.mass-vs-weight | lab |
| mech.torque-units | Newton-metres and kilogram-force centimetres | mech.torque.static | lab |
| mech.perpendicular-distance | Tilting changes the moment arm | mech.moment-arm | lab |
| mech.arm-own-mass | The arm's own weight counts | mech.torque.static | lab |
| mech.centre-of-mass | Where the weight acts | mech.arm-own-mass | lab |
| mech.equilibrium | Balanced torques: nothing turns | mech.torque.static | lab |
| mech.torque-margin | Rated torque versus needed torque | mech.torque.static, act.rated-vs-stall | lab |

**Actuation (Lab 2: inside the servo, gearing)**
| ID | Concept | Prerequisites | Coverage |
|---|---|---|---|
| act.motor-basics | A motor turns electricity into turning | mech.force | guided |
| act.servo-what-it-is | A motor that holds a position | act.motor-basics | lab |
| act.servo-parts | Motor, gears, position sensor, control board, horn | act.servo-what-it-is | lab |
| act.gear-ratio | Teeth counts set the ratio | act.servo-parts | lab |
| act.torque-speed-tradeoff | More torque, less speed | act.gear-ratio | lab |
| act.gear-losses | Friction and backlash cost some torque | act.gear-ratio | guided |
| act.stall-torque | The most it can push before stopping | act.servo-what-it-is | lab |
| act.rated-vs-stall | Use the rated figure, not the stall figure | act.stall-torque | lab |
| act.dc-motor | Brushed DC motors | act.motor-basics | discussion |
| act.stepper | Stepper motors | act.motor-basics | discussion |
| act.brushless | Brushless motors | act.motor-basics | discussion |

**Sensing and control (Lab 3: feedback control)**
| ID | Concept | Prerequisites | Coverage |
|---|---|---|---|
| sense.position-sensor | The servo knows its angle | act.servo-parts | guided |
| ctl.open-vs-closed-loop | Acting with or without checking | sense.position-sensor | lab |
| ctl.error | Target minus actual | ctl.open-vs-closed-loop | lab |
| ctl.proportional | Push harder the bigger the error | ctl.error | lab |
| ctl.overshoot | Going past the target | ctl.proportional | lab |
| ctl.steady-state-error | Never quite arriving under load | ctl.proportional, mech.mass-vs-weight | lab |
| ctl.pid-overview | Adding memory and damping | ctl.overshoot | guided |
| sense.encoder | Counting turns | sense.position-sensor | discussion |

**Power, dynamics, kinematics, design (outside the MVP labs)**
| ID | Concept | Prerequisites | Coverage |
|---|---|---|---|
| pwr.voltage-current | Voltage and current | none | discussion |
| pwr.stall-current | A stalled motor draws the most current | pwr.voltage-current, act.stall-torque | discussion (safety-critical) |
| pwr.battery-safety | Lithium battery care | pwr.voltage-current | discussion (safety-critical) |
| dyn.inertia | Moving needs more than holding | mech.torque.static | discussion |
| dyn.friction-backlash | Real joints stick and wobble | act.gear-losses | discussion |
| kin.degrees-of-freedom | How many ways it can move | sys.joint-and-link | discussion |
| kin.workspace | Where it can reach | kin.degrees-of-freedom | discussion |
| des.requirements | What it must do | sys.what-a-robot-is | guided |
| des.safety-factor | Leaving room for the unexpected | mech.torque-margin | guided |
| des.measure-vs-model | Checking the model against a measurement | des.safety-factor | guided |

That is 46 concepts. The three labs are **lab.servo-torque**, **lab.servo-gearing** and **lab.feedback-control**.
M4 builds only **lab.servo-torque**; the other two are guided until M6 (milestones doc).

**The demo path uses:** sys.joint-and-link → mech.pivot → mech.moment-arm → mech.mass-vs-weight →
mech.torque.static → mech.arm-own-mass → act.servo-what-it-is → act.servo-parts →
act.rated-vs-stall → mech.torque-margin.

**Built and validated by code:** IDs exist, prerequisites form no cycles, every lab concept links to a
solver, and every concept has a coverage tag. Safety-critical flags are set in the graph, not left
to the model (the m3-report open decision).
**Effort:** 1 session (JSON, schema, validation, tests). **Risk:** the graph is Claude's draft. It needs a
roboticist's review before beta, so it is labelled draft in the UI until then.

## 2. Analogy scenes from primitives

All three are built in code from boxes, spheres, cylinders and capsules. Each is labelled
**"Illustrative (AI-composed)"** (T1, visuals doc §2.1): Claude Code composes them and Lucky reviews.
None is a simulation (visuals doc §2.2). A scene that moves is labelled
"Illustrative animation, not a simulation". No numbers appear in any analogy.

| Scene | Acts out | Teaches | Where it breaks down |
|---|---|---|---|
| **Shopping bag** (in M4) | A figure holds a bag close to the body, then at arm's length; the arm trembles and lowers | mech.moment-arm, mech.torque.static | A person tires and their muscles ache; a servo does not tire, but it heats up under a constant load and can stall. A shoulder has no rated torque. |
| **Long wrench** (in M4) | A figure loosens a stuck bolt with a short wrench, fails, then succeeds with a long one | mech.moment-arm, mech.perpendicular-distance | You push a wrench briefly, but a servo arm carries its load all the time, and tilting the arm changes the distance that counts. |
| **Bicycle gears** (after M4) | A figure pedals up a slope in a low gear: easy pedalling, slow wheel | act.gear-ratio, act.torque-speed-tradeoff | A bike's chain links two sprockets far apart; a servo's gears mesh directly in a small box, and small plastic gears lose more to friction and play. |

The fixtures already hold two analogy records (fx-shopping-bag, fx-long-wrench) with mapping text.
The real entries are written fresh, with each "where it breaks down" line reviewed by Lucky.

**How a figure is animated (no rigging, no downloads).**
- The figure is a hierarchy of primitives with pivots at the joints: shoulder, elbow, hip, knee, and a neck so it can look.
- Each pose is a set of joint angles in degrees.
- An animation is a named list of keyframes (pose and time as a fraction of the animation), declared in the scene's manifest.
- The renderer interpolates angles each frame, with easing. Its length is a multiple of the spatial motion token (500–700 ms per move, brand doc).
- **Reduced motion:** it jumps through a few still key poses, as the lever's weight slide already does.
- Animations are checked like other IDs: the validator accepts only names the scene declares.
- A shared figure module (about 15 parts) is reused by every analogy, so a new analogy is mostly poses and props.

**Effort:** the figure rig, keyframe player and shopping bag take 2 sessions; the long wrench 1 session.
**Risks:**
- A primitive figure can look crude. Keep it deliberately stylised, using Tactile Spatialism's soft materials, not a realistic person.
- Animation timing must follow the narration (section 8), or the analogy plays before it is explained.

## 3. The servo + arm scene and the inside-the-servo scene

### 3a. Servo + arm (Lab 1)
- **Model:** a **generic hobby-style servo**, never a named product.
  - **Updated 16 Oct 2026 (slice 2 of the anatomy integration):** the servo is the scripted generic micro servo asset (`asset.servo-generic-anatomy`, Blender, illustrative, not measured) at its true size: about 23 mm of body (32.5 mm with the mounting ears), 12.2 mm wide. It stands on the base with its output shaft pointing at the viewer (+z), the case hanging below the shaft, and the horn turned along the arm. The joint is the shaft axis at the horn's outer face; all distances are measured from it. The arm, load and base are code primitives.
  - Named parts: base, output horn, servo case, gear train, motor and position sensor, control board and cover (the asset's nodes), arm link, load.
  - Label: from `contentLabel` (scene provenance "authored", fidelity simplified teaching): "Simplified teaching model".
  - **Anatomy (slice 3, 16 Oct 2026):** the scene declares `servo-explode`, `servo-open` and `servo-assemble` (marked `uses_asset`: offered to the professor only when the scene's asset is published, so today only through the fixture asset). One generic implementation reads each part's explode direction and distance, and the asset's `open_parts`, from the asset manifest. The servo is always settled in exactly one of assembled, open or exploded; an interrupt settles a change in flight at its end state, and queued actions never run. A part inside the assembled case, when highlighted, shows the case see-through (no auto-explode). There is no camera action in the director contract, so the camera is tied to the animations: open and exploded frame the servo from the front-left, a little above (the arm runs to the right), at about 60% of the free area; assemble and the torque steps (which also put the servo back together) return to the whole scene. While open or exploded the arm, load, base and torque marks are hidden ("Arm and load hidden while you look inside"; changed from dimmed on 16 Oct 2026), the camera fits the servo's parts to about 70% of the free area and centres them, and part labels sit beside their parts with leader lines; the settings and numbers never change. The explode spacing was shortened the same day (horn 30, case 28, gear train 1, motor 0, board and cover −2 mm along the shaft; illustrative, about 2× the servo's height). Learner controls: Explode, Open, Assemble; a line says whether Aili or the learner did it.
  - **The bag handover (slice B, 17 Oct 2026):** the shopping-bag analogy has a picture, `bag-hold` (shoulder, arm, hand, bag with a handle; one setting, the reach 0.10–0.30 m; `bag-reach-out` takes it to its longest; illustrative, generic, not measured; `auto_select: false`, so the engine never puts it up by itself). Its manifest carries a human-written `handover` to the servo scene: the reach becomes the arm length and the load distance (the load at the end of the arm), clamped into the servo's bounds, masses and the learner's rating never carried; bag → load, shoulder → servo case, arm → arm link. The shared stage function (`settingsAfterSelect`) applies it on `select_scene` on both the page and the server, and animations declare what they leave on stage (`sets`), so the reach-out is known to the server too. The model only selects the scene. An analogy counts as told in words only unless its picture was on stage during the turn; the page's note goes when the picture appears. Scene titles are no longer sent in the prompt's scene list (IDs, part names and settings only).
  - **Parts and gears (slice 4, 16 Oct 2026):** while the servo is open or exploded, the explanation space shows each part's name and one-line role from the asset manifest ("illustrative, generic") in place of the equation steps, with the total, the rating field and the margin kept in compact form (the numbers never change); the steps come back on assemble. The gear train has one child node per gear; `servo-gears-turn` (also `uses_asset`) turns each gear at its shaft's speed from the ratio chain (`shaftSpeeds` from `gears.json`), labelled "Illustrative animation, not a simulation", only while the gears are in view, stopping on interrupt, a new turn, assemble or Stop; under reduced motion, direction arrows and the ratio text instead. The ratio line ("Gear ratio 46.1 : 1", computed on the page; "example tooth counts, not measured; ideal gears; friction and efficiency not modelled") is never connected to the rated torque, and no RPM, efficiency or motor numbers are shown. Narration names the ratio in words only.
  - **Founder demo mode (slice A, 16 Oct 2026):** `npm run dev:demo` runs the live dev server in the founder demo mode, for filming. A live turn's published fixture scene (`fx-servo-arm`, with `asset.fx-servo-generic-anatomy`) is labelled from its own manifests and shown without the drafts flag: "Prepared · reviewed by the founder, not an expert reviewer" and "Live AI · Founder-reviewed demo content" only when the scene and the asset both carry a founder review record; otherwise "Prepared · not reviewed" and "Live AI · Demo content, not reviewed". The live note says "Narration is live AI; the lesson content is prepared and founder-reviewed, not expert-reviewed" (or "… prepared and not reviewed yet"). The professor's shortlist is unchanged; production builds ignore the mode. The scene note adds "Generic micro servo at its true size (illustrative, not measured; not a specific product)".
  - The existing base-joint-arm placeholder becomes this scene.
- **Sliders** (units and bounds from the manifest): arm length, payload mass, arm mass per length, arm angle,
  and the **servo's rated torque**, which the learner reads from their own datasheet.
  - No product value is built in; the default is a deliberately round teaching value, labelled "example rating".
- **Torque model:** the existing `solver.static-torque-single-link`.
  - Its outputs already declare units: total torque N·m and kgf·cm, payload torque, arm torque, share of rating.
  - It already includes the **arm's own mass**.
  - No number appears anywhere except through the solver.
- **Torque arrow:** a curved arrow at the joint.
  - Its size follows the solver's total torque on a fixed visual scale; it is not a measurement.
  - It splits into two colours for the payload share and the arm's own share, with a label and an icon, never colour alone.
- **Margin gauge:** driven by the solver's share of rating. Pass, Warn and Fail each have their own icon and word (brand doc §3a).
  - The thresholds come from config, not code. They are a design choice for Lucky to set, not engineering facts.
- **Label:** "Simulation only; hardware untested" (CLAUDE.md), until a measurement is logged in the Workbench (M5).

### 3b. Inside the servo (guided, simplified)
- An exploded view: case halves apart, motor, a gear train of several stages from small to large, the output shaft, the
  position sensor and a control board shown as a plain block.
- A **"turn the motor" animation**: gears turn in sequence, each slower than the one before. It is labelled
  "Illustrative animation, not a simulation", with "Simplified teaching model; not a specific product."
- No solver in M4. A gear-ratio solver with textbook worked-example tests is a Lab 2 item (M6).
- **Effort:** servo + arm with arrow and gauge, 2 sessions; gear scene, 1–2 sessions.
- **Risks:**
  - Gear-train realism invites "is this how MY servo looks?" questions. The label and the professor answer honestly.
  - The scene's polygon count on the Itel; primitives keep it small.

### Why play_animation showed nothing on the lever
- **Ignored by the live path.** `useDemoTurn.applyAction` (apps/web/src/turn/useDemoTurn.ts) has no case for
  `play_animation`: a comment there says the fake director never used it. The validator accepted
  `slide-weight-out` because the lever scene declares it, then the client dropped it silently.
- **Only the prepared lesson can play it.** `useLessonPlayer.slideWeight` implements it, and only for prepared beats.
- **It would play too early anyway.** Even with a case added, it would run when the action event arrives, before any
  narration is spoken (section 8a).

The fix is part of slice 1: move the animation code into one shared module that both the lesson and live
turns use. Also, an action the client cannot play becomes a visible warning in the dev log, never a silent no-op.

## 4. Readings: five items for Lucky's guides

**Plain fact:** the library today holds **two sources and zero verified readings**.
- Both sources are OpenStax books: *College Physics 2e* and *University Physics Volume 1*.
- Both are CC BY-NC-SA 4.0, with "link out; quote only short excerpts".
- Both records say `"verified": null`.
- Each source records **one** section URL. Nothing else is recorded.

The rule is "propose from the verified library only, invent nothing". So only two items can be named, and both
need Lucky to verify the source first.

| # | Item | Source and location (as recorded) | Concepts | Status |
|---|---|---|---|---|
| 1 | Forces and torques in muscles and joints | College Physics 2e, §9.6 (URL in `src.openstax-college-physics-2e.json`) | mech.torque.static, mech.moment-arm, mech.arm-own-mass | Lucky verifies the source, reads the section, writes the guide |
| 2 | Examples of static equilibrium | University Physics Vol. 1, §12.2 (URL in `src.openstax-university-physics-1.json`) | mech.equilibrium, mech.torque.static | Same |
| 3–5 | **Not named:** Claude cannot verify other sections from here and will not guess chapter numbers or titles | To be chosen by Lucky from the two books' own tables of contents, or from new sources Lucky verifies | Suggested topics to look for: introducing torque; centre of mass; gears or simple machines | Lucky picks, verifies and writes the guide |

**What code does:**
- Store each reading with its section, concepts, level, purpose and estimated minutes.
- Store Lucky's guide: key claims, misconceptions, teach-back prompts, application question.
- Keep `verified` empty until Lucky records who checked it and when, and refuse to assign an unverified item (the existing rule).
- **Effort:** 0.5 session for code. Lucky's writing is the main cost, perhaps 30–60 minutes per guide.

## 5. Study planner v1 and the beginner journey

- **Inputs:**
  - the goal, as free text or a picked topic;
  - the baseline: "new to this", "some", or "not stated";
  - time per session;
  - the intent (understand, build, or both).
- **Built by code, not the model** (architecture §9):
  - From the goal's target concepts, walk prerequisites down the graph, sort them so prerequisites come first, and group them into units.
  - Each unit has its concepts, its activities (analogy scene, real-part scene, calculation, reading, teach-back), an estimated time and a **checkpoint**.
  - It is validated: prerequisites first, every ID exists, every unit has a checkpoint.
  - The model may only pick the goal's target concepts from the graph. It never builds the order.
- **Editable table of contents:**
  - The learner can reorder within prerequisite limits.
  - Skipping a unit needs a waiver; safety-critical units need an explicit acknowledgement (product rules).
- **It replaces the live stand-in:** the current unit's concepts become each turn's shortlist. Today live mode shortlists
  every fixture concept.

**The beginner journey (demo path), four units:**
1. **Why far is harder** (mech.pivot, mech.moment-arm): shopping-bag analogy, then a prediction.
2. **Meet the servo and the arm** (sys.joint-and-link, act.servo-what-it-is, act.servo-parts): the servo + arm scene, then naming the parts.
3. **How much torque, including the arm's own weight** (mech.torque.static, mech.arm-own-mass): the calculation on the same scene, with the arrow.
4. **Is this servo strong enough?** (act.rated-vs-stall, mech.torque-margin): the rating slider and margin gauge, then a teach-back.

**Effort:** 2 sessions. **Risks:**
- Topic matching for free text: "I want to build a robot arm" must map to target concepts. Use the router plus a fixed topic list, and say "not covered yet" honestly.
- A plan shown before the learner has done anything can feel heavy. Show it on demand, as a table of contents, not a dashboard.

## 6. Asset sourcing (nothing downloaded)

**Preference: primitives in code** (about 0 KB extra; geometry is generated). Every M4 scene above can be primitives only.
If an asset is ever needed, these are candidates. **Each licence must be checked on the item's own page
before use**, and the licence and author recorded in the registry (visuals doc §1.1, §1.3).

| Source | Typical licence (verify per item) | Attribution | Phone size cost | Use for |
|---|---|---|---|---|
| Kenney (kenney.nl) | CC0, as stated on the site | None required (credit welcome) | Low: small low-poly packs | Props (tools, crates) |
| Quaternius | CC0, as stated on the site | None required | Low to medium: low-poly | Props, simple figures |
| Poly Haven | CC0 | None required | **High:** textures and HDRIs run to megabytes; models are often detailed | Avoid on phones, or use only small textures |
| ambientCG | CC0 | None required | Medium to high: textures | Avoid; prefer flat materials |
| Sketchfab | Varies per model: CC BY needs credit, **CC BY-NC cannot be used in a paid product**, CC BY-ND cannot be modified | Per model | Often high (detailed meshes) | Only a vetted single item, after optimisation |

**Budget:**
- Keep each scene under a small size budget, measured on the Itel production build.
- No HDRI environment maps; lights and flat materials are enough.
- Any glTF goes through the pipeline in visuals doc §1.2: named parts, metres, compressed.

**Risk:** "free" models sometimes carry the wrong licence or a named product's shape, which is forbidden (no invented anatomy of a named real product).

## 7. Three-minute demo script (learner actions, for Lucky's approval)

Live mode, laptop. Times are approximate; no numbers are spoken except those the solver produces.

| Time | Learner does | Learner sees and hears |
|---|---|---|
| 0:00 | Opens Learn | The welcome: "What do you want to learn?" over a dimmed stage |
| 0:10 | Types "I want to build a robot arm" | Aili asks one plain question about what they already know, with choices |
| 0:25 | Taps "Nothing yet" | Aili: "Let's start with something you have felt." The **shopping-bag figure** lifts a bag close, then at arm's length, as each line is spoken |
| 0:55 | Answers the prediction chip ("harder far out") | Aili explains the moment arm while the figure's arm trembles; then states where the analogy breaks down |
| 1:20 | Listens | The stage changes to the **generic servo + arm**; each named part lights up as Aili names it |
| 1:45 | Drags the payload slider farther or heavier | The **torque arrow** grows; Aili gives the solver's value, marked as calculated, including the arm's own share |
| 2:10 | Sets the rating slider to their datasheet value (or keeps the example) | The **margin gauge** shows Pass, Warn or Fail with icon and word |
| 2:30 | Opens the explanation panel | The step's values with units, assumptions, limits and the reading |
| 2:45 | Explains it back in one sentence (teach-back) | Aili checks it against Lucky's guide and asks one follow-up; it never declares mastery |

## 8. Visuals follow the explanation

### 8a. How actions are timed today (checked in the code, 14 Oct 2026)
**Lucky's belief is right, and it is slightly worse than "the first frame".**
- **The server sends everything at once.** It validates the whole answer, then sends every event in one burst, in this order:
  all narration events, then all actions, then calculated results, then the prompt (`packages/engine/src/turn.ts`).
- **The page applies each action as soon as its event arrives** (`useDemoTurn.onEvent → applyAction`), while the voice
  state is still "thinking".
- **Speech starts only after the whole turn has arrived** (`voice.playTurn` on `turn.done`).
- **So the scene change, highlight and slider change all land within milliseconds, before the first word.** `play_animation` is
  dropped entirely (section 3).
- **The prepared lesson is coarser too.** It applies a beat's actions when the beat starts; a beat holds several lines, so it is not per line either.

### 8b. The smallest change
- **Schema:** each action gets a required `at` field naming the narration segment that explains it (`"at": "n2"`).
  - This is one extra short string on the flattened action object.
  - It must be probed with `npm run schema-probe` first, because the schema is close to the provider's grammar limit (m3-report).
- **Validator rules (rejected for repair, plain messages):**
  1. `at` must name a narration segment in this answer.
  2. Actions are applied in segment order; within a segment, in list order.
  3. **Nothing referred to before it is on stage:**
     - the highlight rule becomes per segment: segment *i* may say "highlighted", "highlight" or "the marked part" only if a highlight
       is bound to a segment ≤ *i*, or is still on stage;
     - a segment that names a part of a scene not yet selected by segment *i* gets a **warning** (part names are common words, so this is not an error).
  4. "An action appears with the segment that explains it" cannot be fully checked by code. It is a **warning** when the
     highlighted part's name, or the animation's subject, is not in its segment's text. The prompt says it plainly.
- **Prompt line:** "Bind each action to the narration segment that describes it (`at`); never mention something before it is on stage."
- **Client:** on `turn.done`, the page groups actions by segment.
  - `playLines` already steps through segments and dispatches "speak" for each. At that moment it first applies that segment's actions, then shows the caption and starts speech.
  - Animations start there and run alongside the words.
  - Calculated values are already part of their segment's caption.
- **Server state:** the server keeps the turn's actions with their segments, so it can reconcile an interrupt (8c).

### 8c. Interrupt, voice off and voice on
- **One code path for both.** Voice on: a segment ends when speech finishes, with a safety timer. Voice off (captions
  only): it ends on a reading-time timer (`speakSegment` already does both). Bound actions fire at each segment's start either way.
- **Interrupt** (Stop, Escape, the voice button) bumps the voice revision, as now.
  - `playLines` stops scheduling, so the **queued segments' actions never run**.
  - A running animation checks the revision every frame and stops, as the lever slide already does.
  - Speech is cancelled; captions clear and the page shows "Stopped."
- **The server must agree with what was shown.** Today the server commits the whole turn's state (scene, highlight) when the turn
  completes. After an interrupt mid-speech the page would show less than the server believes.
  - The interrupt request will say how far the page got (the last segment shown).
  - The server keeps the stage state from actions bound to segments up to that point.
  - The explanation panel lists only the segments shown, with "Stopped here."
- **Before the turn arrives**, interrupt works as now: the stream is cancelled and nothing reaches the stage.

### 8d. Effort and risk
- **Effort:** about 2 sessions.
  - Schema, probe, validator and prompt: 0.5–1.
  - Client queue and shared animation module: 0.5–1.
  - Server reconcile on interrupt: 0.5.
  - Tests (unit, recorded e2e for voice on and off, interrupt mid-segment): included.
  - Live check: a few turns, about 0.10 USD.
- **Risks:**
  - **Grammar limit:** the new field may be rejected by the provider; the probe decides. The fallback is index-based binding (`at` as a number) or binding by segment order.
  - **More repairs at first** while the model learns to bind actions: visible in the logs, costed.
  - **Phone speech engines** sometimes never fire "end". The safety timer already covers this; on a stalled engine the visuals would follow the timer.
  - **Prepared lessons** keep beat timing for now; moving them to per-segment binding is a later, separate change.

## Not in this plan

Labs 2 and 3 (M6), the Build Workbench (M5), a gear-ratio solver, the bicycle-gears analogy, commissioned art, AR/VR,
accounts and the database stage, deployment, any downloaded asset.

## Points for Lucky to decide

1. Approve the concept list as a draft (with a roboticist's review before beta).
2. The margin gauge thresholds (Pass, Warn, Fail) as a design choice in config.
3. Readings 3–5: which sections or new sources to verify.
4. Approve the demo script, or change the steps.
5. Approve section 8 as the first slice (it changes the professor's output schema).

---

## Addendum (15 Oct 2026): analogy visuals, docking, and the equation built on the servo

**Why.** In the founder's live test on 14 Oct (live session `7de301e6`, turn 10, "can you explain with another
anology"), the professor described a shopping bag at arm's length in words, while the stage showed the ruler and
played its weight slide on "Stretch your arm out". No picture of the bag existed, and nothing said so. The founder
also wants the equation animated on the object.

**The sequence.** Bag analogy (turn A) → in turn A's last segment the professor selects the servo + arm, and the
bag docks into a small still recap thumbnail → the servo + arm takes the stage with its torque arrow and panel → the
professor teaches with the servo (sliders, torque arrow, margin gauge, τ = F × d built step by step), each
explaining turn ending with a check. Narration allows at most four segments per answer, so this takes two turns.

### Decisions (Lucky, 15 Oct 2026)
1. **Layout-doc wording approved.** It goes into `docs/aili-stage-layout.md` §1 only when the docking slice starts:
   > **Stage:** large rounded canvas, **one active scene at a time**. When an analogy hands over to a real-part scene, the analogy may stay as a **docked recap**: a small still picture in a corner, with its own badge (for example *Illustrative (AI-composed)*), never animating and never a second 3D view. Tapping it makes it the active scene again. A new scene that is not the analogy's partner clears it. Reduced motion: the handover is a cut. Phones: the recap is a small thumbnail with a tap target of at least 44 px, or a "Recap" chip when the stage is too small, and it hides while the inspector or a panel is open.
2. **Equation narration is words only for now.** Overlays show solver numbers; narration names the quantities in
   words ("the force shown at the load"). Spoken numbers (stage placeholders such as `{{stage.torque_nm}}`, which
   would need the page to send its scene settings) are deferred.
3. **Cut from the demo scope:** the long-wrench analogy and the optional analogy↔system pairing beat. The wrench
   can still be used in words, labelled by the honesty rule.
4. **Build order:** A honesty rule → B equation steps → C bag scene + docking → D demo rehearsal (a recorded browser test). Each slice stops for approval.

### A. Honesty rule: a visual analogy only when its picture exists (0.5 session)
The registry already limits the professor to shortlisted items, but an analogy is a text record (mapping and
breakdown) with no link to a picture, so nothing tells "with a picture" from "in words only".
- **Registry:** an optional `scene` field on analogy records names the scene that illustrates it.
- **Shortlist:** each analogy shows `visual: "<scene id>"` or `visual: none` (model input only; the output schema
  does not change).
- **Page (the guarantee):** a turn that uses an analogy whose picture is not on stage shows the label
  "Analogy in words only. No picture of this yet." beside the caption, whatever the narration says.
- **Prompt:** "If an analogy's visual is none, describe it in words only; do not tell the learner to look at it or watch it."
- **Validator warnings** (never rejections, until bake-off data says otherwise): narration that points at an
  analogy object ("watch the bag") with no picture of that analogy on stage; and a turn using an analogy with no
  picture that plays a stage animation on a different object (the bag-versus-ruler case).

### B. Equation steps on the servo + arm (1.5–2 sessions)
No new action types: five scene animations declared in the servo + arm manifest, played with `play_animation`
and bound to their segments (output schema unchanged; about five new action types would add roughly 800–950
characters and pass the provider's ~3,177 limit).

| Step | What appears | Numbers from |
|---|---|---|
| `eq-force` | a downward arrow at the load, F (N) | solver (new force outputs, with worked-example tests) |
| `eq-distance` | a dimension line from joint to load, d (m) | the scene's setting |
| `eq-torque` | "F × d" becomes the curved torque arrow at the joint, τ (N·m) | solver |
| `eq-arm-share` | the arm's own weight at mid-arm, added as a second contribution | solver (arm's own mass always included) |
| `eq-margin` | the margin gauge; "Enter your servo's rated torque" until the learner has | solver and config |

Overlay labels come from the page's solver readout for the settings on stage, so they always match the picture.

### C. Bag scene and docking (about 3 sessions)
- A stylised figure from primitives (shared figure module with joint pivots), poses `hold-close` and `arm-out`,
  labelled "Illustrative (AI-composed)" and "Illustrative animation, not a simulation", no numbers; its
  breakdown line written fresh and reviewed by Lucky.
- Docking: when the servo + arm is selected after the analogy, the analogy becomes a still SVG recap thumbnail
  (not a second 3D view); tap to restore. Session state still holds one active scene.
- Reduced motion: cuts, and the analogy steps through still poses. Phones: as in the approved wording.

### D. Demo rehearsal (0.5–1 session)
The 20-second moment as a recorded browser test: turn A (bag close, bag out with its breakdown, hand over to the
servo + arm), then turn B (force, distance, torque with the arm's share, margin; ending with a check). The rating
is typed in first, from a datasheet. At the current caption pace, turn B runs closer to 20–25 seconds unless the
segments stay short.

**Effort in scope:** about 6–7 sessions (A 0.5, B 1.5–2, C 3, D 0.5–1, live checks 0.5–1). If it must shrink:
keep two poses and drop the tremble (−0.5), merge `eq-arm-share` into `eq-torque` (−0.25), make the recap
still-only with no tap to restore (−0.25).

---

## Addendum (15 Oct 2026): setup cards and the Plan tab (plan only; nothing built)

**Principle.** The stage shows scenes, never the study plan. Before any scene exists, at most three short
**setup cards** appear one after another on the empty (dimmed) stage. Once the plan is built, its table of
contents lives in a **Plan** tab of the right explanation panel: closed by default, opened once when the plan is
first created, a bottom sheet on phones. The plan is built and validated by code from the concept graph; the
model only picks the goal.

### 1. Setup cards (on the empty stage, before the first scene)
- **Order:** the learner types what they want at the existing welcome box ("What do you want to learn?"), then:
  1. **Level:** "What do you already know about this?" chips *Nothing yet / A little / Some / A lot* (the same
     content file as the engine's level question, `content/level-question.json`, so the wording lives in one place).
  2. **Time:** "How long do you have per session?" chips such as *10 min / 20 min / 30 min+* (from a content file).
  3. **Goal:** "Which of these fits what you want?" chips from a fixed topic list, matched to the typed text by
     the router (the model only picks among listed goals), plus *Not sure*. A goal that matches nothing says
     plainly "That isn't covered yet" and offers the nearest covered goal (logged as demand). The intent
     (understand / build / both) is folded into the goal chips, so there are never more than three cards.
- **Each card:** one question, chips (44 px or more), a **Skip** button, keyboard and screen-reader friendly
  (the card is a labelled group; focus moves to the next card's first chip); reduced motion: cards cut in, no slide.
  Skipped answers stay "not stated". Cards are page UI, not model turns: no cost.
- **No double asking:** a level answered on the card sets the learner level; a level *skipped* on the card is
  remembered as asked, so the engine does not supply the level question again (needs a small session flag,
  for example `level_asked`).
- **How answers reach the server:** today the client sends only its text (an M3 hard rule). The cards need a
  small structured field on the turn request (for example `setup: { level?, minutes?, goal? }`, enums only,
  validated against the content files). **This changes that rule: Lucky's decision.**

### 2. The Plan tab (right panel)
- **Tabs:** Explanation · **Plan** · Library (Plan added; `SideView` gains "plan"; the existing tab keyboard
  model is kept: arrows move between tabs, Escape closes).
- **Opens once:** when the plan is first created, the panel opens on the Plan tab (desktop: beside the stage;
  phone: bottom sheet at half height, so the stage stays visible). Focus stays where it was; a polite
  announcement says "Your plan is ready: 4 units". After that it opens only on request (and from the menu).
- **Contents:**
  - a heading "Your plan" and the label **"Draft plan, not yet expert-reviewed"** (icon + text);
  - units in order (an ordered list), each with its title, its concepts in plain words, an estimated time
    (from the time card), and its **checkpoint** ("Checkpoint: explain it back", "Checkpoint: predict, then
    check");
  - **status by icon + label, never colour alone:** *Done* (check), *Now* (filled marker plus a heavier border on
    the current unit), *Not started* (open circle);
  - **Edit order:** a "Reorder" button switches each unit to Move up / Move down buttons (no drag, so it works
    with a keyboard and on phones). A move that would put a unit before its prerequisites is disabled, with
    the reason ("Needs unit 2 first"). The server re-validates every change. Skipping a unit needs a waiver
    (§5); safety-critical units need an explicit acknowledgement.
- **Phone:** the same tab inside the bottom sheet; units collapse to title + status + checkpoint, details on tap.

### 3. Proposed wording for `docs/aili-stage-layout.md` (for approval; not edited yet)
- §1 Top bar, current: "menu (plan/table of contents, notes, settings, help, sign out)."
  Proposed: "menu (**Plan**, which opens the panel's Plan tab; notes, settings, help, sign out)."
- §1 Text explanation panel, add after the current text:
  > **Plan tab:** the study plan's table of contents (units in order, a checkpoint per unit, the current unit marked, done / not done by icon and label, an editable order within prerequisite limits), labelled "Draft plan, not yet expert-reviewed". Closed by default; opens once when the plan is first created. Never shown on the stage.
- §1 Stage, add:
  > **Setup cards:** before the first scene exists, at most three short cards (level, time, goal), one after another on the empty stage, each with chips and a Skip option. They are not scenes and never return once the plan exists.
- §1 Phone, current: "text panel as bottom sheet". Proposed: "text panel as bottom sheet (with the Explanation, Plan and Library tabs)".

### 4. What it needs from the study planner (§5)
- **The concept graph (§1)** with prerequisites, coverage and safety flags. Today `concepts.json` is a flat list
  of ten draft concepts with no prerequisites, so this comes first.
- **Units as content:** the four demo-path units (§5) authored in content (concepts, activities, checkpoint,
  estimated minutes), so the planner orders and checks them rather than inventing groupings.
- **The planner itself (code):** targets → prerequisite closure → order → units; validation (prerequisites
  first, IDs exist, every unit has a checkpoint); pure and tested.
- **Goal picking:** the fixed topic list mapped to target concepts, and the router's choice among them only.
- **Session state:** the plan and the current unit on the server (in memory until the database stage); a plan
  event to the page; a reorder request the server validates.
- **Progress:** a unit is *Done* when its checkpoint passes (a revealed prediction or a graded teach-back),
  never from one answer claimed as mastery.
- **The shortlist from the current unit** (replacing today's live stand-in of all fixture concepts).

### 5. Effort and risks
| Part | Sessions |
|---|---|
| Concept graph with prerequisites, coverage, safety flags; validation (§1) | 1 |
| Units content and the planner core with validation tests (§5) | 1 |
| Setup cards (three, Skip, accessibility, phone, reduced motion), setup request field, plan creation on the server | 1 |
| Plan tab (list, status, checkpoint, current unit, draft label, opens once, bottom sheet) | 0.5–1 |
| Reorder within prerequisite limits, server-validated | 0.5 |
| Goal picking (topic list, router choice, "not covered yet") | 0.5–1 |
| Current unit drives the shortlist; progress on checkpoints | 1 |
| **Total** | **about 5.5–6.5** (§5's earlier 2-session estimate did not include the graph, the cards or the tab) |

**Cut first if needed:** reorder (−0.5; show the order read-only), the time card (−0.25; estimates in minutes
only), progress by checkpoint (−0.5; mark *Now* only).

**Risks:**
- Setup before teaching can feel like a form: keep it to three cards, each skippable, under ten seconds.
- The structured setup field changes the "client sends only text" rule (a decision above).
- Prompt budget: the typical professor prompt is at 4,949 of 5,000 estimated tokens; a current-unit shortlist
  should shrink it, but the plan must not add text to every turn.
- The concept graph and units are Claude's drafts and need a roboticist's review before beta; the tab says "Draft".

---

## Addendum (15 Oct 2026): post-demo option, scene settings and the rating sent with each turn (not approved)

Today the page sends only the learner's text (an M3 hard rule), so the professor never sees the sliders the
learner moved or the rated torque they typed. Consequences: the professor cannot state the real margin (it is
told to point to the panel instead, and a rated-torque calculation input is rejected), and a calculation about
the stage can only use the settings the turns themselves set.

**Option for after the demo:** send the scene's current settings and the learner's rating as a small,
validated structured field with each turn (for example `stage: { scene, settings: { arm_length_m, … },
rated_torque_nm? }`), every value checked against the scene manifest's bounds on the server and never trusted
otherwise. The engine would then use them for calculations about the scene on stage, and a rating share could
become a real placeholder. **This changes the "page sends only text" rule and is to be approved separately**;
nothing is built for it.

**Decision (15 Oct 2026):** option C, structured stage settings (and the rating) sent with each turn, is the
post-demo fix for numbers after the learner moves a slider. Until then the page shows "The professor's numbers
use the settings from its last turn." (option A), and calculations about the scene on stage use the settings
the turns themselves set (a shared stage function on the page and the server).
