# M4 plan: a true beginner's first lab, in 3D (servo torque, end to end)

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
| ctl.steady-state-error | Never quite arriving under load | ctl.proportional, mech.torque.static | lab |
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
- **Model:** a **generic hobby-style servo** built from primitives, never a named product.
  - Named parts: base, servo case, output horn, arm link, payload, mounting screws (simplified).
  - Label: "Generic servo, simplified. Not a specific product."
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
