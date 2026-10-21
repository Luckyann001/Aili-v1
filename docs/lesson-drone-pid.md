# Aili MVP: Drone PID Lesson and Build Guide

Oct 21, 2026 · @lucky

## Overview

The MVP is one lesson, about 12 to 15 minutes long: **a drone holding its altitude with a PID controller.** The learner tunes P, then D, then I, and sees what each one fixes. Every number on screen comes from Aili's solver, never from the AI.

**Who it's for:** curious beginners and makers who know school maths (a graph, "faster" versus "further") but no control theory.

**By the end the learner can:**

1. Explain feedback in one sentence: measure, compare with the target, correct.
2. Say what P, I and D each do, and which problem each fixes.
3. Predict that a P-only drone hovers below its target, and explain why gravity causes it.
4. Apply it to a new case: a heavier drone, or a steady wind.

**How this doc is organised:** the teaching model (what the solver computes), the lesson script beat by beat with its visual, the visual spec, the reading guide, then the build steps and the Claude Code prompts.

**Fidelity label for the whole lesson:** *Simplified teaching model* (registry value `simplified_teaching`). The drone moves only up and down, and the doc states what that leaves out.

**Corrections after the plan review (Oct 21 2026):** drag raised to 1.0 N·s/m so the bounce dies out within a run; overshoot, settling and stability defined; standard gravity; max thrust fixed at the base mass; clamping anti-windup; wind and "start at hover" inputs; the car analogy covers P and I only; key claim 6 reworded; kebab-case part IDs; a procedural (coded) asset format; reading items are drafts; `overshoot_ratio` instead of `overshoot_pct`; chips-only prepared mode. The sections below already include them.

## The teaching model

The solver simulates a drone that moves only up and down. Thrust pushes it up; gravity and air drag pull against it. The PID controller sets the thrust from the gap between the target height and the measured height.

**The drone (what the solver integrates):**

```latex
m \frac{dv}{dt} = T - m g - c\,v - F_{wind}, \qquad \frac{dz}{dt} = v
```

**The controller:**

```latex
e = z_{target} - z, \qquad u = K_p\,e + K_i \int e\,dt - K_d\,v, \qquad T = \mathrm{clamp}(u,\ 0,\ T_{max})
```

In words: z is height (m), v is vertical speed (m/s), m is mass (kg), g is standard gravity, 9.80665 m/s² (the app-wide value, decided Oct 15 2026), c is a linear drag coefficient (N·s/m), and T is thrust (N), which can't go below zero or above the motors' maximum. F_wind is a downward push (N).

**Drag** is a fixed scene constant, c = 1.0 N·s/m, not a slider, labelled *drag is simplified and exaggerated so the bounce dies out quickly*. (At c = 0.4 the bounce takes about 2m/c = 5 s to shrink by e, so a P-only drone is still swinging at the end of a 15 s run.)

**Maximum thrust** is T_max = (thrust-to-weight ratio) × m_base × g, with the base mass m_base being the drone without the camera; adding the camera does not make the motors stronger. Default thrust-to-weight ratio: 2. The D term uses the drone's measured speed rather than the change in error, which avoids a jolt when the target moves.

**Solver rules**

- Fixed time step of 2 ms, semi-implicit Euler, 15 s per run. The ground is at z = 0 and the drone can't go below it.
- Anti-windup (clamping): the I term stops adding up while thrust is at a limit (T_max or 0 N) and the error would push it further past that limit. On the ground below its weight it keeps adding: that is what lifts a drone whose P term alone is too weak (a ground freeze would leave it there for ever; found while building the solver).
- Inputs with bounds: mass 0.5–2 kg, Kp 0–40 N/m, Ki 0–100 N/(m·s), Kd 0–15 N·s/m, target 0.5–5 m, thrust-to-weight ratio 1.5–3 (default 2), payload 0–1 kg with the total mass inside 0.5–2 kg, drag 0–5 N·s/m for checks (the lesson fixes it at 1.0), optional wind push 0–5 N with a start time (0–15 s) and a duration (0–15 s; no duration means a steady wind), and a start state: on the ground (default) or *start at hover* (at the target, at rest, with the I term already holding the weight; needs Ki > 0).
- Outputs: height, thrust and the three P/I/D contributions over time; final error (at the end of the run); `overshoot_ratio` and `overshoot_m` (peak − final height, the bounce in metres); settling time; whether thrust hit its limit; and a stability flag (settled, still oscillating, or not dying out).

**Definitions**

- **Overshoot** is measured from the drone's own resting height, not the target: `overshoot_ratio` = (peak height − final height) ÷ (final height − start height), shown as a percentage at the edge. A P-only drone can overshoot its resting height without ever reaching the target line.
- **Settling time** is the first time after which the height stays within ±2% of the final height until the end of the run. It counts only if the drone has stayed in the band for at least the last 3 s; otherwise the last sample alone would always count as settled.
- **Stability flag:** *settled* if a settling time exists; *not dying out* if the swing (max − min height) over the last 3 s is no smaller than over the 3 s before; otherwise *still oscillating*. With thrust limits a truly growing oscillation is impossible; it becomes a steady one, hence "not dying out". "No smaller than" allows 2%: two 3 s windows of a steady swing differ by a few tenths of a percent (measured 0.996–1.002), while a dying bounce at the presets is at most about 0.88.

**Facts the tests must confirm** (I checked these in a quick simulation; Claude Code's tests are the real proof):

| Case | What happens | Test |
| --- | --- | --- |
| No gains | Drone stays on the ground | thrust is 0 throughout |
| P only | Bounces, then settles **below** the target | final error ≈ m·g / Kp (0.98 m for m = 1 kg, Kp = 10); settled within the run |
| Bigger P | Smaller gap, more bounce | Kp = 30 leaves ≈ 0.33 m, with a larger `overshoot_m` than Kp = 10, and it rises past the target line. Its `overshoot_ratio` is *smaller* (0.51 against 0.61): the motors sit at maximum thrust for about 1.8 s, which caps the climb |
| P + D | Bounce gone, gap still there | same final error as P only, no overshoot |
| P + I + D | Reaches the target exactly | final error ≈ 0 |
| Too much I | Overshoots and rings; past the limit it never settles | linear model (no thrust limits) is stable only while (Kd + c)·Kp > m·Ki; with the presets the limit is Ki = 70, so Ki = 40 rings but is stable |
| Heavier drone, P + D | Bigger gap | m = 1.5 kg, Kp = 10 leaves ≈ 1.47 m |

Starting presets for the lesson (m = 1 kg, c = 1.0 N·s/m, target 2 m): P only Kp = 10; P + D adds Kd = 6; full PID adds Ki = 4; "too much I" uses Ki = 40. These are configuration, never words in Aili's narration.

**Where the model stops** (Aili says this at the end of the lesson):

- Real drones also tilt and move sideways. This model is height only.
- Real motors take time to speed up; here thrust changes instantly.
- Air drag here is a simple straight-line rule and deliberately exaggerated so the bounce dies out quickly.
- Real height sensors are noisy, and D amplifies noise, so real controllers filter it.
- Real flight controllers usually add a "hover thrust" estimate and run several loops inside each other.
- The numbers teach the idea. They are not settings for tuning a real drone.

## Lesson script

Eight beats, about 12 to 15 minutes. Each beat follows the behaviour spec: at most one question before an explanation, and every answer gets something back. Narration below is the gist, not final wording. Numbers appear only as placeholders such as `{{final_error_m}}`, filled by the solver.

### Beat 0: The hook (about 30 s)

- **On stage:** the drone hovers at the dashed target line. A wind gust pushes it down; it climbs back and settles.
- **Aili:** "This drone has no pilot. Many times a second it measures its height and decides how hard to spin its propellers. In this lesson you'll build that decision yourself."
- **Probe:** "The drone is below its target. What should it do?" Chips: *Push harder* · *Push less* · *No idea*.

### Beat 1: The feedback loop (explain, about 1 min)

- **On stage:** a loop draws around the drone: **Measure** (height sensor glows) → **Compare** (an error bracket appears between the drone and the target line) → **Correct** (thrust arrow grows).
- **Aili:** answers from the learner's chip, then: "The gap between where it is and where it should be is called the **error**. Every controller in this lesson only ever looks at that gap. The question is how to turn a gap into thrust."

### Beat 2: P, the push (predict, run, explain, about 3 min)

- **Predict:** "Here's the simplest rule: push harder the bigger the gap. That's P, for proportional. Where will the drone end up?" Chips: *Exactly on target* · *Above it* · *Below it* · *Bouncing forever*.
- **Learner:** presses **Run**.
- **On stage:** the drone rises, bobs, and settles **below** the line. The error bracket stays open and shows `{{final_error_m}}`. Weight arrow (down) and thrust arrow (up) end the same length.
- **Aili explains the mechanism:** "To hover, thrust must equal the drone's weight. But P only pushes when there's a gap. So the drone sinks until the gap is just big enough to make that thrust. No gap, no push." The equation `Kp × gap = weight` lights up, each term highlighted with its arrow.
- **Analogy (about 40 s):** cruise control on a hill (see the visual spec). The car settles a little slower than the set speed, just as the drone settles a little low. The analogy shows P and I only; D is introduced on the drone in beat 3.
- **Learner:** drags the **P** slider higher and runs again. The previous run stays as a faint ghost line on the plot. The gap shrinks to `{{final_error_m}}`, but the bounce gets bigger (`{{overshoot_ratio}}`, shown as a percentage).
- **Check:** "So why not just make P huge?" Aili takes the answer, then explains: more P means harder pushes, so more overshoot, and the motors have a maximum.

### Beat 3: D, the brake (about 2 min)

- **Aili:** "Let's fix the bounce first. If you were flying it by hand, what would you do as it rushes up toward the line?" Chips: *Ease off early* · *Push harder* · *Not sure*.
- **Explain:** "D, for derivative, watches how fast the drone is moving and pushes against that speed. Rushing up means it eases off before it overshoots."
- **On stage:** three bars beside the drone show the P, I and D contributions to thrust. While the drone climbs, the D bar points down.
- **Learner:** adds D and runs. The bounce is gone. The gap is still there, still `{{final_error_m}}`.
- **Aili:** "Notice D didn't fix the gap. At rest the speed is zero, so D adds nothing."

### Beat 4: I, the memory (about 3 min)

- **Probe:** "The drone has been too low for a while now. What kind of rule would notice that?" Learner picks a chip (prepared mode is chips only); in live mode they may also type.
- **Explain:** "I, for integral, keeps a running total of the gap over time. While the drone stays low, the total keeps growing and adds more thrust, until the gap is closed."
- **Learner:** adds I and runs. The drone reaches the line. The error bracket closes.
- **On stage, the key moment:** at rest, the P and D bars shrink to zero and the **I bar alone holds up the weight**. Aili points it out: "Now the memory is doing the holding, so the gap can be zero."
- **Learner:** picks the *Too much I* preset and runs. The drone overshoots and rings. The checks strip shows **Warn: still oscillating** with its icon and label.
- **Aili:** "I has momentum. Its total takes time to unwind, so it keeps pushing after the drone has passed the line. Tuning is a balance."

### Beat 5: New situations (transfer, about 2 min)

- **Predict:** "We bolt on a camera, so the drone is heavier. With P and D only, will the gap be bigger, smaller or the same?" Learner commits, runs, and sees `{{final_error_m}}` grow. Aili ties it back: more weight needs more thrust, so P needs a bigger gap.
- **Check:** "A steady wind pushes down. Which term brings the drone back to exactly the target?" Answer: I. A wrong answer gets the mechanism explained, not "try again".

### Beat 6: Teach-back (about 1 min)

- **Aili:** "Tell me in one sentence each what P, I and D do."
- **Live mode:** the learner types; Aili grades it against the reading guide's key claims. A vague answer gets one follow-up. No mastery claim either way; the result is saved as evidence.
- **Prepared mode (chips only):** a self-check: the learner compares their own sentence with the key claims, labelled as a self-check, not graded.

### Beat 7: Limits, further reading, what's next (about 1 min)

- **Aili:** states where the model stops (from the teaching model), in two or three short lines.
- **Library:** one verified reading item opens in the drawer (see the reading guide).
- **Teaser:** "You just tuned a controller by hand, the way engineers do. Some robots now learn their controllers through practice. That's a later lesson." A *Tell me when it's ready* chip logs interest as demand. Until the database stage this goes to the local dev turn log only, and the UI says so ("Noted on this computer only for now").

**Pacing rule for the whole lesson:** no more than about 30 seconds of narration or animation without the learner doing something.

## Visual spec

The stage shows one side view of one drone, with the plot and the P/I/D bars beside it. Everything that moves is driven by the solver's output; nothing is animated by hand.

**Drone asset** (`asset.quadcopter-generic`, coded in Three.js, asset format `procedural`: a code module with a triangle budget checked by a test, no GLB file; labelled *generic, simplified teaching model*; part IDs are kebab-case):

| Part ID | What it is | Used in |
| --- | --- | --- |
| `body` | central frame | all beats |
| `arm-1`–`arm-4` | four arms | exploded view |
| `rotor-1`–`rotor-4` | propellers; spin speed follows thrust (illustrative) | beats 0–5 |
| `motor-1`–`motor-4` | motors under the rotors | label only |
| `sensor-altitude` | height sensor under the body; glows on "Measure" | beat 1 |
| `battery` | battery pack | label only |
| `payload-camera` | added camera; adds mass in beat 5 (max thrust does not change) | beat 5 |

**Stage elements**

| Element | Shows | Driven by |
| --- | --- | --- |
| Target line | dashed line at the target height, labelled | target input |
| Height ruler | metre marks on the left edge | scene units (metres) |
| Error bracket | the gap between drone and target, with `{{error_m}}` | solver: error |
| Thrust arrow (up) and weight arrow (down) | lengths to scale; equal at hover | solver: thrust; mass × g |
| P / I / D bars | each term's share of thrust; can point down | solver: term contributions |
| Feedback loop overlay | Measure → Compare → Correct ring | beat 1 only |
| Height plot | height over time, target line, faint ghost of the previous run | solver trace |
| Sliders | Kp, Ki, Kd with units and bounds; presets *P only*, *P + D*, *PID*, *Too much I* | simulation manifest |
| Checks strip | final error, overshoot, settling time, stability; Pass / Warn / Fail with icon and label (thresholds in `config/teaching-thresholds.json`, a design choice labelled as such) | solver outputs |
| Badges | *Simplified teaching model* and *Prepared* or *Live* | registry + session |

**Analogy animation: cruise control on a hill** (`analogy.cruise-control-hill`)

A car with cruise control set to a speed drives onto a hill. With P-like control it settles slightly slower than the set speed; a driver who notices "I've been slow for a while" (I) closes the gap. The analogy covers P and I only: D is introduced on the drone, not the car. The scene then dissolves into the drone in the same frame, with the mapping labelled. I chose this over the shower knob because the hill pulling the car back maps directly onto gravity pulling the drone down, which is the exact cause of the P-only gap.

| In the car | In the drone |
| --- | --- |
| set speed | target height |
| actual speed | measured height |
| hill pulling the car back | gravity pulling the drone down |
| accelerator | motor thrust |
| "slower, so press harder" | P |
| "slow for a while, keep adding" | I |

**Where it breaks down** (Aili says this): a car controls speed while the drone controls height, which adds one more step between push and result. That extra step is why the drone bounces and the P-only car does not, so the car has no bounce for D to fix: D belongs to the drone. A human driver also sees the hill coming and presses early; a basic PID only reacts to the gap it already has.

The cast follows the brand doc: geometric figures in Sage, Sky, Gold and Plum with Ink outlines on Canvas, no mascot.

**Colours and accessibility**

- Stage on Deep canvas; drone and arrows in Sky; target line and focus in Copper; the "discovery" moment (I bar holding the weight) in Gold.
- Pass / Warn / Fail always carry an icon and a word, never colour alone.
- Reduced motion: no animation; the stage shows the final state and the plot draws in one step.
- Phone: stage on top, plot and sliders in the bottom sheet, touch targets at least 44 px.
- Every visual carries its provenance badge. A "report a problem with this visual" action is marked *coming* (not built yet).

## Reading guide

This is the human-written guide Aili grades teach-backs against. It is yours to review and correct; nothing here copies a course.

**Key claims** (a good teach-back mentions most of these):

1. A feedback controller measures, compares with the target, and corrects, over and over.
2. P pushes in proportion to the current gap.
3. With gravity, P alone leaves the drone below the target, because it needs a gap to make the thrust that holds it up.
4. D pushes against the speed of change, which damps the bounce. At rest it adds nothing.
5. I adds up the gap over time, so it keeps increasing thrust until the gap is zero. At rest it holds the weight.
6. Too much P or I causes overshoot and ringing (too much I can stop it settling at all); too much D makes it sluggish, and on real drones amplifies sensor noise.

**Common misconceptions to watch for**

- "D makes the drone go faster." It does the opposite: it resists fast changes.
- "I is just a stronger P." P reacts to the gap now; I reacts to the gap's history.
- "Bigger gains are always better." They trade a smaller gap for more bounce, and motors have a limit.
- "The controller knows the drone's weight." A basic PID doesn't; it only sees the gap.
- "P only should reach the target eventually if you wait." With a constant pull like gravity, it never does.

**Teach-back prompts:** "In one sentence each, what do P, I and D do?" Follow-up if vague: "Why does a P-only drone hover low?"

**Application question:** "A delivery drone picks up a parcel mid-flight. What happens to its height with P and D only, and what fixes it?" Expected: it sinks to a bigger gap; I brings it back.

**References to check against** (link out only, never copy):

| Source | Use | Licence | Status |
| --- | --- | --- | --- |
| [MIT 16.30 Feedback Control Systems, Fall 2010](https://ocw.mit.edu/courses/16-30-feedback-control-systems-fall-2010/) | fact-check; candidate reading item | CC BY-NC-SA: link only, no copying into Aili | course page found; pick the lecture and verify |
| [MIT 16.06 Principles of Automatic Control, Fall 2003](https://dspace.mit.edu/handle/1721.1/85861) | introductory fact-check | CC BY-NC-SA 3.0: link only | archive page found; verify the content |
| Brian Douglas, PID videos (MATLAB Tech Talks) | beginner-friendly video reading item | not checked | from memory; find and verify |
| Åström and Murray, *Feedback Systems* | deeper reading | reportedly free online; terms not checked | from memory; find and verify |
| Anatomy skill output ("how a drone holds its altitude") | visual ideas only | MIT licence for the skill; output unreviewed | optional; never shipped to learners |

**Your checking step (about one hour):** read the PID lecture in one MIT source and tick each key claim above against it. Anything you can't confirm, flag to me before it goes into the lesson. Then record each source in the source register with title, URL, licence, what you may do (link only), the date, and your name.

## Build steps

Nine steps; Claude Code does steps 2 to 7 one at a time, and you check each before the next. With the YC deadline about 13 days out, aim to finish step 7 within a week, leaving time to review and test. Keep the servo lesson working as a backup demo.

1. **You: put this doc in the repo.** Export it as Markdown and save it as `docs/lesson-drone-pid.md`. Then create a branch: `git checkout -b lesson/drone-pid`. Commit the doc.
2. **Claude Code: plan only (Prompt 1).** It reads the doc and the codebase and proposes the plan. You approve or push back. No code yet.
3. **Claude Code: the solver and its tests (Prompt 2).** The PID drone solver in the shared solver package, with tests for every row of the "facts the tests must confirm" table. Check: all tests pass, and the report shows the P-only gap matching m·g / Kp.
4. **Claude Code: the content files (Prompt 3).** Concept nodes, the simulation manifest, the analogy manifest, candidate reading items and the lesson beats, all as drafts in git. Check: you read the lesson text and the analogy mapping.
5. **Claude Code: the drone and the stage (Prompt 4).** The coded drone with named parts, target line, ruler, error bracket, arrows, P/I/D bars, plot with ghost run, sliders, presets and checks strip. Check: run `npm run dev:demo` and move the sliders yourself, on your laptop and phone.
6. **Claude Code: the lesson flow (Prompt 5).** Wire the eight beats into the existing prepared/live system, with chips, placeholders and the professor shortlist. Check: walk through the whole lesson once as a learner.
7. **Claude Code: the analogy animation and final tests (Prompt 6).** The cruise-control scene dissolving into the drone, then the full test suites. Check: watch the analogy once with reduced motion on and once off.
8. **You: review and record.** Tick the key claims against MIT (reading guide), add your founder review record, do a dry run on a mid-range Android phone, then record the demo.
9. **You: test with 5 to 10 people.** Watch them use it without helping. Ask the transfer question right after, and again a week later. Note every question Aili couldn't answer.

**Working habits for each step:** start Claude Code in plan mode (Shift+Tab), run `/clear` between steps, keep one step per session to stay within your plan's limits, and read the report before approving the next step.

**Optional: get visual ideas from the Anatomy skill** (do this once, any time before step 5)

1. Open [github.com/wheresryan22/anatomy](https://github.com/wheresryan22/anatomy), skim the README and `SKILL.md`, and check the install command matches the one below. It's third-party code that will run inside Claude Code.
2. Install it (needs Node.js 20.10 or newer): `npx skills add wheresryan22/anatomy -g -a claude-code`
3. Run it in a separate folder, **not** the Aili repo: `mkdir ~/anatomy-drafts && cd ~/anatomy-drafts && claude`
4. In Claude Code: `/anatomy explain how a PID controller keeps a quadcopter drone at a fixed altitude, interactive`
5. Expect up to about two hours of agent time, which can use a whole Pro usage window. Run it when you don't need Claude Code for anything else.
6. Open the result in your browser, take screenshots of what you like, and check anything it shows against the reading guide's key claims. Use it as a sketch for step 5; never copy its files or numbers into Aili.

## Claude Code prompts

Paste one prompt per session, in plan mode, after `/clear`. Wait for each report before the next.

**Prompt 1: plan only**

```text
We are changing the MVP lesson from servo torque to a drone holding its altitude with PID. Read CLAUDE.md, docs/lesson-drone-pid.md (the full lesson spec), and the parts of the codebase you need: the solver package, registry content, the servo lesson and demo mode, the director/validator, and the e2e suites.

Do not write code yet. Propose a plan that:
1. Reuses the existing engine (registry, validator, prepared/live labels, demo mode, stage). List what is reused and what is new.
2. Splits the work into the five build steps in the doc (solver, content, drone and stage, lesson flow, analogy and tests), with the files each step will touch.
3. Keeps the servo lesson working as a second lesson and backup demo.
4. Lists every doc conflict you find (for example, the milestones doc says Lab 1 is servo torque) and proposes the doc edits, without making them.
5. Names anything in the lesson spec you think is wrong or unclear, especially in the physics.

Then stop and wait for my approval.
```

**Prompt 2: solver and tests**

```text
Implement step 1 of the approved plan: the drone altitude PID solver (solver.pid-altitude-1d) in the shared TypeScript solver package, exactly as in docs/lesson-drone-pid.md, section "The teaching model": the equations, 2 ms semi-implicit Euler, ground clamp, thrust clamp with max thrust fixed at the base mass, clamping anti-windup, D on measured speed, input bounds, optional wind, start at hover, and all listed outputs with the stated definitions (traces, P/I/D contributions, final error, overshoot_ratio, settling time, saturation flag, stability flag).

Write tests for every row of the "facts the tests must confirm" table, plus the linear stability boundary (Kd + c)·Kp > m·Ki with saturation turned off, bounds rejection, and unit checks. Tests must compare against the analytic values (m·g/Kp), not just snapshots.

Run lint, typecheck and tests. Small commits. Report what was built, test results, anything in the spec you changed and why, and doc conflicts. Then stop.
```

**Prompt 3: content files**

```text
Implement step 2: the content for the drone PID lesson as draft registry items in git, following the existing schemas:
- concept nodes using the ctl.* IDs from docs/m4-plan.md: ctl.open-vs-closed-loop, ctl.error, ctl.proportional, ctl.overshoot, ctl.steady-state-error, plus ctl.derivative and ctl.integral (prerequisites, L1/L2/L3 levels, misconceptions from the reading guide); none safety-critical;
- sim.pid-altitude-1d manifest (inputs with units and bounds, presets P only / P + D / PID / Too much I, outputs, assumptions, exclusions from "Where the model stops", fidelity simplified_teaching);
- analogy.cruise-control-hill with the mapping table and the "where it breaks down" note;
- reading items as drafts (review_status draft; their sources verified null) with the reading guide's key claims, misconceptions, teach-back prompt and application question; links out only;
- the eight lesson beats from "Lesson script", with numbers only as solver placeholders.
All review_status draft. Do not mark anything verified or reviewed. Run the content checks. Report, then stop.
```

**Prompt 4: drone and stage**

```text
Implement step 3: asset.quadcopter-generic as coded Three.js geometry (asset format procedural) with the named kebab-case parts in the "Visual spec" table, labelled generic, simplified teaching model, in metres. Then the stage elements in that section's table: target line, height ruler, error bracket, thrust and weight arrows to scale, P/I/D bars, height plot with a ghost of the previous run, Kp/Ki/Kd sliders with units and bounds, the four presets, and the checks strip with Pass/Warn/Fail icon plus word. Everything that moves reads from the solver output; nothing is hand-animated. Follow the brand tokens, reduced-motion still state, phone layout and 44 px targets. Keep the asset small for mid-range Android.

Run lint, typecheck, unit tests and e2e on desktop, tablet and phone. Tell me exactly how to open it in demo mode and what to try. Report, then stop.
```

**Prompt 5: lesson flow**

```text
Implement step 4: wire the eight beats of docs/lesson-drone-pid.md into the existing prepared/live lesson system. Each beat sets the stage state, shows its chips, and fills placeholders from the solver. Respect the behaviour spec: at most one question before an explanation, every answer gets something back, wrong predictions get the mechanism explained. The live professor sees only the shortlist for these concepts; the validator must reject any hard-coded engineering number. Labels stay honest: Prepared vs Live, and "not reviewed" until I add my review record (give me the exact lines and file path; do not add it yourself). The "Tell me when it's ready" chip logs demand.

Adapt the professor session tests to this lesson (quick question, true beginner, wrong prediction, confident wrong claim, frustration, invented-reference trap, numbers). Run everything. Tell me the exact steps to walk through the lesson. Report, then stop.
```

**Prompt 6: analogy and final checks**

```text
Implement step 5: analogy.cruise-control-hill as a short scene (about 40 s) with geometric cast figures in the brand palette, no mascot: car on a hill with P-like control settling below the set speed, then I and D behaviour, then the car dissolving into the drone in the same frame with the mapping labelled and the "where it breaks down" note shown. Add a reduced-motion version as still frames. Then run the full lint, typecheck, unit, e2e (desktop, tablet, phone) and no-drafts suites. Report what was built, how it was verified, what was not, and any doc conflicts. Then stop.
```
