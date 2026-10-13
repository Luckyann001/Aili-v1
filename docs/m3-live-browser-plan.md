# Plan: live turns in the browser (laptop only)

**Status:** PLAN ONLY, for Lucky's approval. Nothing is built and nothing is spent until approved.
**Date:** 13 Oct 2026. **Branch:** `m1/learn-stage-shell` (local commits only).
Read with `docs/m3-report.md`, `docs/m3-plan.md` and `docs/aili-stage-layout.md` §1.

## Today

`/api/turn` runs only the fake (scripted) director, behind `NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1`. The
live professor runs only from the command line (the bake-off). The caption overlay shows narration and
choice chips, but not the prompt's question text. The explanation panel shows prepared-lesson text only.

## Goal

On Lucky's laptop: open the Learn stage, type anything, and get one live turn on screen (narration, the
question with choice chips, calculated values, a stage action) from the live professor, clearly
labelled, with every turn logged locally.

## Rules this plan keeps

- **Laptop only.** A new **server-only** flag `AILI_LIVE=1` (not `NEXT_PUBLIC_`), set only in
  `apps/web/.env.local`, turns on the live route. Production builds refuse it at build time, and the
  existing no-drafts e2e build checks it is off. The key is read on the server at call time, never sent
  to the browser, never logged.
- **Local requests only by default.** The live route answers only requests from this computer
  (localhost), so a phone on the Wi-Fi (`npm run dev:lan`) cannot spend money unless Lucky turns that
  on with a second server-only flag.
- **The live route keeps every existing check:** the kill switch (read on every request), the session
  cap, the live checks (both keys present, Lucky's limit record), and config's 30 s attempt and 45 s
  turn limits (not the demo's 10 s).
- **Content:** nothing is published, so live turns use the test-fixture registry (m3-plan decision 6),
  labelled as such, and the honest "not supported yet" path for anything outside it.

## Slices

Each slice is small, ends with lint, typecheck, unit tests and e2e, and stops for Lucky.

### Slice 1: the live route on the server (medium)
- `/api/turn` builds the provider-backed director and router (as the bake-off does) when `AILI_LIVE=1`,
  with the checks above and the localhost guard. Without the flag nothing changes.
- The client learns that live mode is on from a tiny server endpoint (`{ live: true }`), not from a
  public build flag, so nothing about live mode is inlined into the bundle.
- **Shortlist for free text:** the planner is not built, so live turns shortlist all fixture concepts
  (torque, moment arm) at L2. A topic outside them gets "not supported yet".
- Unit tests against the local mock server (no key, no network): flag off → 404; production → refused;
  not localhost → refused; kill switch, missing key and missing limit record → plain refusals.
- **Look at in the browser:** with the flag on, a typed message gets a live answer (still shown through
  today's caption UI); with the flag off, nothing changes.
- **Live spend to test:** about 3 turns, **≈ 0.10 USD**.

### Slice 2: demo mode A and the Live AI badge (small)
- With live mode on, the Learn stage opens on an empty "What do you want to learn?" box, nothing
  pre-filled and no prepared lesson starting. Whatever is typed goes to the live professor.
- A **"Live AI"** badge on the stage and on each caption, distinct from "Test fixture" and "Prepared".
  Live answers on fixture content show both: "Live AI" and "Test fixture content".
- The prompt's **question text** is shown (and spoken when voice is on), with the choices as chips;
  tapping a chip sends it as the learner's reply.
- **Look at:** empty box on load; badge visible; question and chips appear; tapping a chip starts the
  next turn; an off-topic request ("Explain ROS 2 launch files") says it is not supported yet.
- **Live spend:** about 5 turns, **≈ 0.15 USD**.

### Slice 3: the explanation panel for live turns (medium)
- The right panel (on demand, as now) shows the current live turn: narration, assumptions,
  limitations, evidence titles from the library, and calculated values with their units, labelled
  "Live AI". The current step only, with the earlier turns below (layout doc §1).
- **Look at:** open the panel after a turn that calculated something (for example "How much torque does
  a 0.3 m arm need to hold a 200 g load?"); every item matches the turn.
- **Live spend:** about 3 turns, **≈ 0.10 USD**.

### Slice 4: waiting, failure and interrupt states (small)
- A thinking state that lasts through 6–25 s turns (with elapsed time); **interrupt** works throughout
  and stops speech and queued actions; plain messages for spending limit, key rejected, timeout and
  kill switch (the engine's existing wording).
- Failure messages are tested with the mock server and the kill switch, not by triggering real limits.
- **Look at:** interrupt a slow turn mid-way; turn on the kill switch and see the plain refusal.
- **Live spend:** about 2 turns, **≈ 0.05 USD**.

### Slice 5: local session log (small)
- Every live browser session writes its turns to a git-ignored folder (`live-sessions/<date-time>/`):
  learner text, the answer as shown, the router's classification, cost, latency, repairs, warnings.
  No key or header is ever written. One readable file per session, so Lucky can pick the best take.
- **Look at:** after a few turns, the folder has one session with every turn and its cost.
- **Live spend:** about 2 turns, **≈ 0.05 USD**.

### Slice 6: e2e test of the live path (medium)
- A test-only mode makes the live route use the **recorded** provider (a recording kept in the e2e
  fixtures, never in a production build), so CI runs the whole browser path with no key and no network:
  type → question with chips → tap a chip → calculated value → stage action → explanation panel.
- Axe accessibility checks and the phone layout, as for the existing Learn stage tests.
- **Look at:** the e2e run passes; nothing to check by hand.
- **Live spend:** **0 USD** (recorded).

### Slice 7: one full live walkthrough (small)
- A 6–10 turn session on the lever scene in the browser, logged by slice 5, for Lucky to review.
- **Live spend:** **≈ 0.25–0.30 USD**.

**Total live spend for testing:** about **0.70 USD**, on the existing 5 USD prepaid credit; each slice
keeps a per-run cap.

## Conflicts and points to confirm (CLAUDE.md and the docs)

1. **Badge name.** The layout doc (§1) lists the stage badge as *Prepared / Live / Illustrative
   (AI-composed)*; this plan uses "Live AI". Either is fine; the doc should be updated to match.
2. **Opening state.** The layout doc describes the Learn stage as "Aili directs a scripted scene for
   one concept". Demo mode A (an empty box, no prepared lesson) is a laptop-only demo mode, not a
   change to the product's Learn stage; it should stay behind the live flag.
3. **Learner text saved to disk (slice 5).** CLAUDE.md requires that learners can inspect, correct and
   delete what is kept, and that consent and data protection are checked before beta. This log is
   Lucky's own laptop sessions only, git-ignored, never uploaded; it must not become a feature for
   other learners without that work.
4. **Phones on the Wi-Fi.** CLAUDE.md allows the key on the laptop only. A phone reaching the laptop's
   dev server would still use the laptop's key; the plan blocks non-local requests by default.
5. **Free-text topics without the planner.** The study planner (CLAUDE.md, product rules) is not built;
   slice 1 uses all fixture concepts as the shortlist. This is a stand-in, not the planner.
6. **Next 16.** Per `apps/web/AGENTS.md`, read `node_modules/next/dist/docs/` before writing the route
   and the server endpoint.
7. **Prepared vs live labelling** (CLAUDE.md honesty rule): every live answer carries "Live AI"; a
   prepared lesson never does; fixture content keeps its "Test fixture" label.

## Not in this plan

Deployment of any kind, a production live route, accounts and saved sessions (the deferred database
stage), voice providers beyond browser speech, the Build Workbench, prompt caching, a second provider.
