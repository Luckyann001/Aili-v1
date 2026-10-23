# M3 report: the live professor (engine)

**Date:** 13 Oct 2026; closing note 14 Oct 2026. **Branch:** `m1/learn-stage-shell` (local commits only; nothing pushed or merged).
**Scope:** the engine and its command-line tools. (When this report was written the web app did not call
the live model; since then it does, on Lucky's laptop only: see `docs/m3-live-browser-plan.md`, slices 1–6.)

## Status: M3 closed on the numbers (14 Oct 2026)

M3 is closed administratively on the results below (100% after repair, 76% first attempt, over all 28
scenarios at their latest runs) and the fixes listed under "Changed since this report". It is not a
claim that every item was checked by a person. **Open items, not done:**

- Lucky has not yet read the transcripts of **s13** (LiPo charging), **s11** (drone PID), **x1** (mains)
  and **s05**.
- Lucky has not yet tried **pushback** or **"teach me guitar"** in the browser.
- **s08 turns 3–4** have not run live since their fix (the cost cap stopped the runs).
- The **highlight rule** and the **"a prompt asks exactly one thing"** prompt line have not been exercised
  by the real model beyond the checks so far (unit tests and the recorded e2e only).
- **Slice 7** (one full live walkthrough in the browser) has not been run.

## Changed since this report (14 Oct 2026; commits a4c06dd..a1a869a)

- **Stray action fields** (a field from another action type, such as "scene" on a highlight) are dropped
  before the checks when the rest of the action is valid; counted warning. (a4c06dd)
- **Every check runs** even when the format check fails, so one repair lists every problem. (e5aeb3d)
- **Learner level starts "unknown"**, marked as not stated by the learner; the prompt forbids claiming the
  learner said what they did not; a first-turn "you said …" warning. (bfe449c)
- **Live logs** name the concepts and the selected scene for each attempt. (b6d7896)
- **Prompt:** a probe's question goes in the prompt field, not only in narration. (72e5dbf)
- **Starting scene:** when an answer names no concept and nothing is on stage, the engine puts the
  topic's starting scene on stage; counted warning. (c7f21ad)
- **Highlight rule:** narration that says "highlighted", "highlight" or "the marked part" with no highlight
  on stage is rejected for repair. (0910862)
- **Prompt:** a prompt asks exactly one thing, never two joined with "and" or "or". (384d16d)
- **Slice 6:** browser e2e of the live path with a hand-written recording (no key, no spend). (a1a869a)

Live checks after these fixes (laptop, own port): "robotics" ×3 passed on the first attempt (0.053 USD);
"robotics" put the lever on stage through the starting-scene rule and "teach me guitar" put nothing on
stage (0.036 USD). Ledger total since the first live call: about **4.76 USD**, plus one turn on Lucky's own
dev server whose cost was shown only in that terminal.
Read with `docs/m3-plan.md` (decisions 1–29) and `packages/engine/README.md` (the rule table).

## What was built

- **Anthropic adapter** (plain `fetch`, no SDK): structured output with a reduced JSON Schema (ID patterns
  removed and the actions union flattened, so the provider can compile it), error mapping (spending
  limits never retried), provider-reported token usage, key read only at call time.
- **Provider-backed router** (Claude Haiku 5.5) that classifies each learner reply; the fake router
  stays for CI. The professor is Claude Sonnet 5.5. Models, prices, limits and timeouts live only in
  `config/ai.json`.
- **Spend safety:** live turns refused without the provider-limit record; worst-case check before each
  turn (inputs padded ×2.5); a cap check before every provider attempt in the bake-off; session cap;
  kill switch; every attempt metered.
- **Teaching state on the server, shown to the professor:** open predictions (recorded by the engine,
  ids `p-turn-N`), open items, waivers, the open question with its choices.
- **Validators:** structural (IDs and concepts in this turn's shortlist, bounds, no hard-coded numbers,
  one question only in the prompt, narration length) and pedagogy (one open question, hold under
  pushback, predict → test → reveal, teach-back graded only against the guide, direct answers,
  unsupported topics, and more). Code rejects only objective violations; semantic checks are warnings.
- **Engine fallbacks, always logged as warnings:** long narration split at sentence ends; the guide's
  exact application question; the one open reading named on a teach-back question.
- **Tools:** a dry run (the full request, key masked, nothing sent), a schema probe, and a bake-off
  harness with 28 scenarios, recorded and live modes, stop rules, transcripts and summaries.

## What was verified, and how

- **Unit tests:** 411 engine tests and 205 web tests pass, with no key and no network; lint and typecheck
  are clean.
- **Live runs** (Anthropic only: Sonnet 5.5 professor, Haiku 5.5 router), test-fixture content:
  - **All 28 scenarios at each one's latest result:** **100% after repair** (50 of 50 turns),
    **76% first attempt** (38 of 50). Caveat: s08's latest runs cover only turns 1–2. It was run
    twice after its fix (13 Oct, 15:28 and 16:02); turn 2 passed both times (once first try, once after
    a repair), and both times the cost cap stopped the run before turn 3. The bake-off's pre-turn check
    assumes about 0.10 USD worst case per turn, so a 0.15–0.20 USD cap cannot reach turn 4. Turns 3–4
    have not run since the fix.
  - **Cost:** about **0.024 USD per turn** at verified list prices. **Latency:** median **6.3 s**;
    the slowest turn in the latest results took 18.2 s, the slowest seen in any run 30.3 s (under the
    45 s turn budget).
  - **Consistency:** c1, c2, c3 ran three times each, c4, c5 and s05 twice each (the cost cap stopped
    the rest). **The professor held its correct position in every run**, including "my teacher told
    me so"; wording differed between runs.
  - **Safety** (latest results): s13 (unattended LiPo charging), x1 (mains power), x2 (stalled servo)
    passed on the first attempt with the safety point raised.
  - **Unsupported topics** (latest results): o1 (inverse kinematics), o2 (ROS 2 launch files), s11
    (drone PID) passed on the first attempt: said so plainly, offered the nearest route, changed nothing
    on stage.
  - **No hard-coded number reached a learner** and no held position was given up without evidence in
    any run (automatic stop checks, plus reading the confident-but-wrong transcripts).
- **Spend:** the engine's own ledger matched the provider Console (2.77 USD) to within 0.003 USD when
  compared; the ledger total since the first live call is now about **4.15 USD**.

## What was NOT verified

- **Only one provider:** no second provider or model pairing was compared.
- **No robotics-expert review** of the transcripts, the physics or the safety wording. Results come
  from automatic checks and Claude reading transcripts, not from a domain reviewer.
- **The web app did not call the live model yet** when this was written (it now does on the laptop;
  see the status section above).
- **No load testing and no mobile testing** of live turns; latency was measured from a laptop only.
- **Test fixtures only:** two concepts, two readings, two analogies; no published content exists yet.
- **Not every fix was re-run in full:** s08 turns 3–4 have not run since its fix (the cost cap stopped
  the run); the consistency check is incomplete for c4, c5 and s05 (two runs each, not three).
- **Recordings from live runs are not reviewed or kept** for CI; CI replays two hand-written ones.

## Known weak spots

- **First attempts:** about one turn in four needs a repair (about 0.02 USD and 5 s extra). Recurring
  causes: narration segments over the limit, a probe without its question, rule conflicts that were
  fixed one at a time as they appeared.
- **Earlier failures, fixed and re-run:** c1 turn 2 passed (its earlier failure was a 215-character
  segment in a four-segment answer; the split may now make five segments within 700 characters, which
  is unit-tested but was not needed in the re-run); s08 turn 2 (a teach-back question without its
  reading, then a second open question) passed on the first attempt.
- **The router is a model:** it has misread replies (answered or not, pushback, direct-answer requests);
  several engine rules now correct for the known cases, not every case.
- **Engine fallbacks** keep turns working but hide model mistakes; they are counted so they stay visible.
- **The output schema is close to the provider's grammar limit:** adding fields may be rejected.
- **Heuristic warnings** (analogy explained, mild praise, arm weight) catch only what they look for.
- **Session state and the ledger are in memory** (lost on restart) until the database stage.

## Open decisions

- **Free tier and billing:** the cap per learner and the billing model (still unresolved).
- **Data region and consent** for learner text sent to the provider (Kenya), before any beta.
- **Prompt caching:** each turn sends about 6–7k input tokens, mostly the same system prompt and schema;
  caching could cut cost but has not been tried.
- **Session posture switch** (Learning to Answer) when a learner keeps asking for direct answers:
  backlog, tied to behavior spec A2.
- **Which concepts are safety-critical** (the `safety_critical` flag), to be set in M4.
