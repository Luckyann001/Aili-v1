# M3 report: the live professor (engine)

**Date:** 13 Oct 2026. **Branch:** `m1/learn-stage-shell` (local commits only; nothing pushed or merged).
**Scope:** the engine and its command-line tools. The web app does **not** call the live model yet.
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
    **76% first attempt** (38 of 50). Caveat: s08's latest run covers only turns 1–2 (the cost cap
    stopped it); its turns 3–4 have not run since the fix that made turn 2 pass.
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
  compared; the ledger total since the first live call is now about **4.09 USD**.

## What was NOT verified

- **Only one provider:** no second provider or model pairing was compared.
- **No robotics-expert review** of the transcripts, the physics or the safety wording. Results come
  from automatic checks and Claude reading transcripts, not from a domain reviewer.
- **The web app does not call the live model yet**; no live turn has run in a browser.
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
