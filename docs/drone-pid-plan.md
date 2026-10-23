# Drone altitude PID lesson: build plan and decisions

**Status:** approved by Lucky, Oct 21 2026. **Branch:** `lesson/drone-pid` (local commits only).
**Spec:** `docs/lesson-drone-pid.md` (the lesson, the teaching model and the prompts). This file is the
plan for building it and the record of every decision taken while doing so.

## Goal

The MVP lesson changes from servo torque to a drone holding its altitude with PID. It reuses the existing
engine; the servo lesson keeps working as a second lesson and backup demo, green at every step.

## What is reused and what is new

**Reused unchanged:** the beat-script validator (IDs, bounds, no numbers in narration, pacing, "Not sure"
on every choice list); the narration number check and `{{placeholder}}` filling; the director validator;
the registry loader and the published-only shortlist; draft/production visibility; `contentLabel` and the
founder-review labels; demo mode (`dev:demo`) and its test-fixture copies; the stage-settings function; SSE
turns, interrupt and stale-action handling; the teaching state; the prepared lesson runner, voice,
captions, side panel and Library drawer.

**Extended:** units (N/m, N/(m·s), N·s/m, s, m/s, N for settings); scene presets; concept levels,
coverage and misconceptions; prepared-beat actions `apply_preset` and `run_simulation`; the asset manifest
gains a `procedural` (coded) format; the solver table in the engine.

**New:** `solver.pid-altitude-1d`; the drone content; the coded quadcopter; the stage pieces; the
cruise-control analogy scene; Pass/Warn/Fail thresholds in `config/teaching-thresholds.json` (a design
choice, labelled as such).

## Steps

| # | Step | Sessions | Status |
|---|---|---|---|
| 1 | Solver and tests | 1 | done |
| 2 | Content (drafts) | 1 | done |
| 3a | Drone asset and scene: the coded quadcopter with named parts on a test stand | 1 | done |
| 3b | Stage pieces: plot with ghost run, P/I/D bars, controls, thrust gauge, checks strip, Run | 1 | done |
| 4 | Lesson flow in the prepared/live system, fixture copies for demo mode, drone session tests | 2 | done |
| 5 | Cruise-control analogy scene and the full test suites | 1–2 | |

Each step stops for Lucky's review. Every step's report includes the servo suites.

**Step 3 split (Lucky, Oct 21 2026), visual ideas borrowed from screenshots in `~/anatomy-figures`, built
in our own code (no code, numbers or files copied; every number from our solver):**
- **3a:** the drone rides a vertical guide post on a test stand, so it is clear why it only moves up and
  down; a lit collar on the mast marks the set height (the target line); the downward rangefinder under
  the body (`sensor-altitude`) glows on the "Measure" step.
- **3b:** a thrust gauge with a tick at the hover thrust (m·g, from the solver's `weight_n`); P, I and D
  toggle switches with lamps as the beginner controls, with the sliders as an "advanced" panel; a gust
  button; the plot, bars, checks strip and Run.

**Keeping the servo lesson working:** servo files are not edited except where a shared list gains a drone
entry; new units and actions are additions; servo-only checks stay tied to the servo; the lesson is chosen
with `?lesson=drone-pid` or `?lesson=lever` (the drone becomes the default only when Lucky approves it).

## Decisions

**Physics and the solver (Oct 21 2026)**
- Drag is a fixed scene constant, c = 1.0 N·s/m, labelled "drag is simplified and exaggerated so the bounce
  dies out quickly" (at 0.4 a P-only drone is still swinging at 15 s).
- Standard gravity, 9.80665 m/s².
- Max thrust = thrust-to-weight ratio × base mass × g, fixed when a payload is added; default ratio 2.
- Clamping anti-windup at T_max and at 0 N. **No freeze on the ground**: it would leave a weak-P drone
  there for ever, since the I term is what lifts it.
- Overshoot is measured from the resting height: `overshoot_ratio` = (peak − final) ÷ (final − start), and
  `overshoot_m` = peak − final. **Narration uses `overshoot_m` only**: with the motors at full thrust a bigger
  P bounces higher in metres but smaller as a ratio (Kp 30: 0.51 against 0.61 at Kp 10).
- Settling: within ±2% of the final height and staying there, for at least the last 3 s of the run.
- Stability: settled; still oscillating; or not dying out (the last 3 s swing is at least 98% of the 3 s
  before; a steady swing measures 0.996–1.002, a dying one at most about 0.88).
- Wind 0–5 N with a start and a duration (no duration: steady); a "start at hover" option (needs Ki > 0).
- Bounds set during the build: payload 0–1 kg (total mass 0.5–2 kg), drag 0–5 N·s/m for checks, wind timing
  0–15 s.

**Content (Oct 21 2026)**
- Concept IDs are `ctl.*` (from `docs/m4-plan.md`): open-vs-closed-loop, error, proportional, overshoot,
  steady-state-error, derivative, integral. None is safety-critical. `ctl.open-vs-closed-loop` has no
  prerequisite (the drone lesson starts there, with no servo first).
- Everything is `review_status: "draft"`; sources are `verified: null`. Fidelity value `simplified_teaching`.
- Part IDs are kebab-case (`arm-1`, `rotor-1`, `sensor-altitude`, `payload-camera`).
- The car analogy covers P and I only; D is introduced on the drone and named in "where it breaks down".
- Key claim 6: too much P or I causes overshoot and ringing; too much D makes it sluggish (and on real
  drones amplifies sensor noise).
- Beat 2 narrates the bigger P run as: the gap shrinks, but the drone shoots higher past where it ends up
  (`{{overshoot_m}}`) and this time crosses the target line.
- Beat 2's prediction chips are "Exactly on target", "Above it", "Below it", "Not sure" (a choice list
  holds at most four).
- The live director's actions stay the original five until step 4; the preset and run actions are for
  prepared beats only until then.

**Modes and labels**
- Prepared mode is chips only; typed answers and graded teach-back happen in live mode only (prepared
  teach-back is a labelled self-check).
- "Report a problem with this visual" is marked *coming*.
- The "Tell me when it's ready" chip logs to the local dev turn log, and the UI says so.

**Docs updated for the change (Oct 21 2026):** `CLAUDE.md`, the milestones (M4 is now the drone lab; the
servo work is recorded as Lab 2, built as drafts), the visuals doc §4, the behavior spec (cruise control
for feedback; drone variants of the session tests), the stage layout (the drone's controls live in the
explanation space), `docs/m4-plan.md` (superseded note, `ctl.*` prerequisites), and the master prompt §8 note.

**Step 3b and 4 decisions (22–24 Oct 2026)**
- Checks thresholds (drafts, Lucky approved 23 Oct): gap Pass ≤ 2% of the set height, Fail > 25%; bounce Pass ≤ 0.05 m, Fail > 0.5 m. The gust: 3 N for 0.5 s from rest where the controller holds the drone (solver start "settled").
- The full view stays; the camera keeps the learner's own zoom or orbit through runs (for a recorded close-up) until Reset view or a new scene.
- At 1366×768 the drone, the height plot and the thrust gauge are in view together without scrolling (tested, with 1920×1080).
- The closed Demo controls are a small button in the stage toolbar.
- `npm run dev:record` (prepared lessons) and `dev:demo` hide the Next.js dev indicator for recordings.
- Step 4 session 1 is the prepared lesson (`?lesson=drone-pid`; the lever lesson stays the default); session 2 the live professor.
- Live drone turns: the professor may send `apply_preset` and `run_simulation`; a run is Aili's, from the ground, after a preset in the same turn (the server cannot see the learner's switches); its numbers come from a calculation bound to the stage's settings. The run rule travels with the drone scene in the shortlist, not in the shared template (the servo prompt was at 4,995 of 5,000 tokens).
- Until the planner exists, a live turn shortlists either the servo's concepts or the drone's `ctl.*` concepts, chosen by a keyword stand-in (both together overflow the prompt budget).
- The drone scene is level L2 (it shows the solver's numbers; live turns shortlist at L2).
- Published test-fixture copies of the drone (scene, solver, simulation, asset, analogy) for demo mode and the recorded live path; no founder review on them ("Prepared · not reviewed").
- The "Tell me when it's ready" chip writes to `live-sessions/demand.md` on a dev server only (topic and place, nothing about the learner); test builds write nothing; production returns 404.
- Beat 1's Measure → Compare → Correct: a dashed Copper ring around the drone and the three steps named on the stage ("Now" on the current one); all three at once under reduced motion.

**Open for Lucky:** the reading item's lecture and time estimate; checking the MIT licences on the pages;
the Pass/Warn/Fail thresholds (step 3b); the founder review record (step 4).
