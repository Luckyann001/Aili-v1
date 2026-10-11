# M2 plan: Engine (registry, solver, validator)

**Status:** approved by Lucky on Oct 11 2026, with the decisions below. Nothing in it is built yet.
**Branch:** `m1/learn-stage-shell`. Local commits only: no push, no remote, no merge.
**Slice 1 does not start until Lucky says so.**
Do one slice per session, then report and stop.

Read with: `CLAUDE.md`, `docs/aili-architecture.md` (§4 registry, §5 per-turn flow), `docs/aili-professor-behavior-spec.md` (A1a, A3–A5, A10, A14), `docs/aili-visuals-curriculum-billing.md` §5.2 (metering), `docs/aili-milestones-and-checklist.md` (M2 and the deferred stage).

## Lucky's decisions (Oct 11 2026)

1. **Doc edits:** approved and applied in commit `43583df`.
   - M1 is paused, with a deferred stage.
   - M2 uses SSE plus a POST interrupt.
   - In the architecture doc, the fidelity value is `verified` and the example asks one question only.
2. **Slice order:** approved.
3. **Textbook sources 1 and 2** (OpenStax) are approved for the solver tests.
   - Open the actual OpenStax pages and copy the examples word for word, with section citations.
   - Show Lucky the diffs before committing.
   - If a page can't be reached, say so. **Never fill in numbers from memory.**
4. **The tilted (cosθ) case:**
   - Use a hand-derived example labelled **"hand derivation, not textbook"**, with the working in a comment, plus the property tests.
   - θ is the angle **from horizontal**, and this is documented.
5. **The shortlist contains published items only.**
   - For the slice 6 demo, use a separate test-fixture registry:
     - marked `test_fixture: true`;
     - loaded only when the dev flag is set;
     - labelled **"Test fixture"** in the UI;
     - **refused by the production loader**, with a test proving it.
   - **Never fabricate a human reviewer name.** Fixtures are "published" only as test fixtures, never with a review record.
6. **The registry stays a validated JSON bundle in M2.** The database sync moves to the deferred stage.
   - "Last stage" means after M6, before M7, and before any public deployment or real AI key.
7. **The billing doc's daily limits, rate limits and spike alerts stay in M7.**
   - M2 builds only the per-session cost cap and the global kill switch.

## 1. What exists (slice 4c) and what M2 adds

| Exists, reused as-is | M2 adds |
|---|---|
| Scene manifests, concepts, `validateRegistry` (strict; published needs a human `review`) | Simulation, solver, analogy and evidence (source + reading item) manifests; `shortlist(concept, level)`, published only |
| `checkNarration` (digits only inside `{{placeholders}}`) | Placeholders must resolve to a calculation output requested in the same turn |
| `Action` union, `Move` enum, `validateBeats` | Director-response schema and validator (structural, then pedagogy) |
| `relativeEffort`, `holdingMoment_nm`, unit converters | `staticTorqueSingleLink` (servo statics; arm mass required) |
| Stale gate (`stamp`, `admit`, `nextRevision`) | Server request IDs; the client gate filters live turn events |
| Voice interrupt (stops speech and queued actions) | A POST interrupt that stops the server stream too |

## 2. Director-response schema and validator

**Schema** (strict; it matches the architecture doc §5 example):
- `request_id`, `state_rev`, `move` (the existing enum), and `safety` (boolean, default false).
- `narration[]` of `{id, text}`, at most 4 segments, with a length cap per segment.
- `actions[]`: the existing union, plus `focus`.
- `calc_requests[]` of `{id, solver, inputs}`.
- `evidence[]` (IDs).
- `prompt` (optional) of `{text, chips[]}`.
- `assumptions[]` and `limitations[]`.

**Structural rules:**
- Every ID (scene, part, parameter, animation, solver, evidence) must be in **this turn's shortlist**, not merely somewhere in the registry.
- Action values and calculation inputs must be within the manifest bounds and use the correct unit field names.
- Evidence must be verified library items.
- No digits anywhere the learner reads (narration, prompt, chips, assumptions, limitations) except inside placeholders. Reuse `checkNarration` and its allow-list.
- Every placeholder must resolve to a calculation output from this turn, e.g. `{{c1.torque_nm}}`.

**Pedagogy rules** (these need the session history):
- **One open question.** A question may only appear in `prompt`; a `?` in narration is rejected. This is enforced by structure, not by guessing at wording.
- A turn with a prompt must also give something back: narration, a result or a visual.
- After the learner answers a probe, the next move must be `explain`.
- Challenge budget: at most one challenge in any three turns, unless the turn has `safety: true`.
- Answer posture: no quiz and no challenge.
- A banned-phrase list for mastery claims and flattery.

## 3. Solver: `staticTorqueSingleLink` (packages/solvers)

- **Model:** `τ = g · cosθ · (m_payload · L + m_arm · L/2)`, plus optional extra point masses at given distances.
  - θ is measured **from horizontal** (0 = arm level, 90° = arm vertical).
  - The arm is a uniform bar; its own mass acts at its middle.
  - The payload is at the tip.
  - Static hold only.
- **Units:** SI inside; every field name carries its unit. Conversions happen only at the edges: g→kg, cm→m, deg→rad, N·m↔kgf·cm (`units.ts` already exists).
- **Arm mass is required and must be greater than 0.**
- **Outputs:**
  - `torque_nm` and `torque_kgf_cm`.
  - `share_of_rating`, only when the learner supplies a datasheet rating. It is labelled stall or continuous, and the solver never invents a rating.
- **Property tests:**
  - torque is 0 at θ = 90°;
  - torque is linear in payload;
  - torque is above 0 with no payload, because of the arm's own mass;
  - unit conversions round-trip;
  - the result agrees with the existing lever solver.
- **Worked examples:**
  - OpenStax sources 1 and 2 below, copied word for word as described in decision 3.
  - For the tilted case, a "hand derivation, not textbook" with the working in a comment, as in decision 4.

| # | Source | Where (from memory, **not yet verified**) | Status |
|---|---|---|---|
| 1 | OpenStax, *University Physics Volume 1* | Ch. 12 "Static Equilibrium and Elasticity", §12.2 examples (forearm holding a weight) | Approved; open the page to confirm |
| 2 | OpenStax, *College Physics 2e* | Ch. 9 "Statics and Torque", §9.6 "Forces and Torques in Muscles and Joints" | Approved; open the page to confirm |
| 3 | Hibbeler, *Engineering Mechanics: Statics* | Ch. 4–5 | Not used in M2 (paid; needs a reviewer with the book) |
| 4 | Meriam & Kraige, *Engineering Mechanics: Statics* | Moments and equilibrium chapters | Not used in M2 |
| 5 | Lynch & Park, *Modern Robotics* | §5.2 statics | Not used in M2 |

Both OpenStax books are **CC BY-NC-SA 4.0** (as stated on their pages, checked Oct 11 2026; the earlier "CC BY 4.0" was from memory and wrong). Tests quote only the data and results they need, with attribution.

## 4. Per-turn flow

- **`runTurn`** is a pure pipeline in `packages/engine`: shortlist → director → validate → solve → compile → events.
  - Every event carries `request_id`, `state_rev` and `seq`.
  - Event types: `turn.started`, `narration`, `action`, `calc.result`, `prompt`, `turn.done`, `turn.error`.
  - On any failure it emits `turn.error` with one plain sentence; the client keeps its last valid state.
- **Routes:**
  - `POST /api/turn` streams Server-Sent Events.
  - `POST /api/turn/interrupt` with `{request_id, state_rev}` marks the request stopped; the stream ends at its next event.
- **Client:**
  - It stops immediately: it aborts the fetch, cancels speech, and drops stale events through the existing gate.
  - The interrupt store sits behind an interface. M2 keeps it in memory, which works locally only; a shared store waits for the database.
- **Fake director:**
  - `FakeDirector` plays scripted scenarios, with injectable delays and faults: a hard-coded number, an unknown ID, a timeout, a malformed response.
  - **No AI provider, no API key and no network calls in M2.**

## 5. Metering

- **Config:** `config/ai.json`, committed, with no secrets. It holds:
  - provider and model names;
  - unit prices (clearly marked test values);
  - voice and hosting rates;
  - the per-session cost cap.
- **Money** is stored as integer micro-USD.
- **The per-session ledger** records:
  - tokens in and out, as reported by the director (the fake one reports fixed counts);
  - voice characters and seconds (browser speech costs 0 but is still counted);
  - hosting, as a per-turn estimate from the config rate.
- **Cap check:** before a turn, compare the cost so far plus the turn's worst case with the cap. If it's over, refuse with a plain message; prepared lessons keep working.
- **Kill switch:** `AILI_AI_KILL_SWITCH=1` refuses every live turn.
- **Storage:** the ledger sits behind an interface, in memory for M2. Persistence waits for the database.

## 6. Slices, in order (about one session each)

| # | Slice | Tests | Needs from Lucky |
|---|---|---|---|
| 1 | Capability schemas (simulation, solver, analogy, evidence) and `shortlist`; a `sim.servo-static-load` manifest as a draft | schema strictness; shortlist returns published items only and respects level | — |
| 2 | Torque solver and unit edges | property tests; OpenStax examples (word for word, diffs shown first); hand derivation for the tilted case | Review the transcription diffs |
| 3 | Director schema and structural validator | a test per rule; spec test 14 (a hard-coded number is rejected) | — |
| 4 | Pedagogy validator (session-aware) | one question; no two questions in a row; probe → explain; challenge budget and its safety exception | — |
| 5 | `runTurn` pipeline with the fake director | event order; a failure keeps the last state; stale events are dropped | — |
| 6 | SSE route, interrupt and client consumer, in the Learn stage under `?demo=1`, with the test-fixture registry | e2e: stream, interrupt mid-turn, a newer input cancels the old turn; the production loader refuses fixtures | — |
| 7 | Metering, cap and kill switch | cap reached mid-session; kill switch on; arithmetic against hand totals | Approve the test prices and the cap value |

Every slice ends with lint, typecheck, unit tests and the e2e run, followed by small commits and a plain report.

## 7. What can't be verified in M2

- Any real model's behaviour (that's M3).
- An interrupt across separate Vercel instances.
- Vercel's limit on how long a streaming function may run.
- Real prices.
- Textbook numbers until they have been transcribed from the actual pages.
- Citations are checked per evidence ID, not per claim; M3 professor tests must probe this.

## 8. Risks and notes

- **Digit rule false positives** (a numbered step, a year). The allow-list grows only by review.
- **No `?` in narration** also blocks rhetorical questions. The M3 prompt must say so.
- **An interrupt across server instances needs shared state**, which waits for the database (deferred stage).
- **Sequencing question to raise:** the milestones list says an LLM key is needed by M3, but the deferred stage (which includes sign-in) comes "before any real AI key", after M6. M3 with a real provider would therefore come after the deferred stage, or M3 runs with the fake director only. To be decided by Lucky before M3.
