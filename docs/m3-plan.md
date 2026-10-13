# M3 plan: the live professor

**Status:** approved by Lucky on Oct 12 2026, with the decisions below. Built one slice at a time; each slice ends with a report, and the next waits for Lucky.
**Branch:** `m1/learn-stage-shell`. Local commits only: no push, no remote, no merge.

Read with: `CLAUDE.md`, `docs/aili-professor-behavior-spec.md` (A1–A14), `docs/m2-plan.md` (§9: session state on the server), `packages/engine/README.md`.

## Decisions (Oct 12 2026)

1. **Keys:** a real AI key may be used on Lucky's laptop only, never deployed and never on any hosting service, until the database stage. This is recorded in CLAUDE.md and the milestones doc.
2. **Budget:**
   - Provider monthly limit: ~~30 USD~~ **5 USD** for the first test (decision 10), set by Lucky in the provider's dashboard and recorded in config.
   - Bake-off cap: ~~25 USD~~ **3 USD** in config (`bakeoff_cap_micro_usd`, decision 13).
   - The bake-off runs every scenario **once**. ~~on two pairings~~ The first test is **Anthropic only** (decision 8); pairing (a) comes later. The 3-run consistency check runs only for the chosen pairing, and only on the confident-but-wrong scenarios.
3. **Models to compare:**
   - (a) GPT-6.1 Sol (professor) + GPT-6 Luna (router);
   - (b) Claude Sonnet 5.5 (professor) + Claude Haiku 4.5 (router). *Superseded by decision 7: Haiku 5.5.*

   **Before slice 7, re-check every model name and price on the providers' own pages.** If a page can't be reached, say so, and Lucky confirms them.
4. **Slice 6:** plain HTTP (`fetch`), no provider SDK, unless structured output can't work without one; if so, ask Lucky first.
5. **Added to M7:** a plain notice that learner text is sent to the AI provider, and the data-region and consent decision.
6. **Readiness:** nothing is published yet, so live turns run against the test-fixture registry, labelled "Test fixture", until an expert publishes content (M4).

### Update (Oct 12 2026, after slice 5b): first live test is Anthropic only

7. **Correction:** "Claude Haiku 5.5" is a real model. Pairing (b) becomes **Claude Sonnet 5.5 (professor) + Claude Haiku 5.5 (router)**, replacing Haiku 4.5 in decision 3.
8. **First live test uses Anthropic only:** professor `claude-sonnet-5-5`, router `claude-haiku-5-5`. Pairing (a) (GPT-6.1 Sol + GPT-6 Luna) comes later.
9. **Prices, as Lucky read them on Anthropic's pricing page:**
   - `claude-sonnet-5-5`: $2 in / $10 out per million tokens;
   - `claude-haiku-5-5`: $0.10 / $0.50 per million tokens, prompts up to 100k tokens.

   These match the test values already in `config/ai.json`. **Slice 7 re-verifies the model IDs and prices on Anthropic's own pages before any call**; if a page can't be reached, Claude says so and Lucky confirms.
10. **Provider monthly limit for the first test: 5 USD** (replaces 30 USD in decision 2). Lucky sets it in Anthropic's dashboard and records it in `provider_monthly_limit_set`; Claude never fills that field in.
11. **Slice 6 builds the Anthropic adapter first** (plain HTTP, decision 4); the OpenAI adapter follows later.

### Update (Oct 12 2026, after slice 7a): settings for the first live run

12. **Config filled in** (model IDs and prices verified on Anthropic's models and pricing pages on 2026-10-12): provider `anthropic`, professor `claude-sonnet-5-5`, router `claude-haiku-5-5`. `provider_monthly_limit_set` stays Lucky's to fill in; it takes an optional `note` (for example, that the real protection is a prepaid balance).
13. **Caps:** session cap **0.50 USD** (test value); bake-off cap **3 USD** for a whole run, checked before every turn.
14. **Thinking and effort** (both models think adaptively by default, and thinking counts toward `max_output_tokens`): router `thinking: disabled`, `effort: low`, 200 output tokens; professor `thinking: adaptive`, `effort: low`, 3,000 output tokens.
15. **Timeouts are config values:** 30 s per provider attempt, 45 s per turn, labelled as first-live-run values. The 7b results report measured latency.
16. **Bake-off scenarios: 28**, the approved list of about 30 less spec tests 12 (interruption) and 14 (hard-coded number), which code checks fully and which need no model. The milestones doc's "~30 scenarios" refers to the same list.

### Update (Oct 12 2026, first live calls): the professor's output schema

17. **What happened:** the first live professor call was refused with HTTP 400 "The compiled grammar is too large" (not billed). Removing the ID `pattern` rules alone was not enough. A schema probe (tiny requests, 7 calls, 0.0216 USD) showed the full schema is only just over the provider's internal limit: removing the actions, the calc requests or the four optional teaching objects each made it acceptable; removing defaults, or only `calc_requests[].simulation`, did not.
18. **What was cut from the schema SENT to the provider** (our own schema and validators are unchanged):
    - the `pattern` rules on IDs (scene, part, concept, calc, capability IDs);
    - the actions union: the five action shapes are sent as **one** object, `type` from the list of action types and every other action field optional. This was the smallest change the provider accepted.
19. **What our validators enforce instead, on every answer** (and a failure gets the one repair, then `validation`):
    - every ID's format and existence in the shortlist (structural validator), as before;
    - each action's shape through the strict action union: every required field for its type present and of the right type, no field from another action type, no unknown type. `show_choices` stays refused from the director (prepared lessons only; the director offers choices through `prompt.chips`).
    - The cost: a wrongly shaped action is no longer impossible to write, only rejected afterwards, so it can cost a repair attempt.
20. **Input estimate factor:** estimated input tokens are multiplied by `input_estimate_factor` (2.5 in config, first-live-run value) in the pre-turn worst case, the per-attempt cap guard and conservative metering. The router's real input was 2.14× the estimate; the schema alone adds roughly 2,000 input tokens to every professor call. Recalibrate from real counts.

### Update (Oct 12 2026, after the first answered live turn)

21. **The first professor answers failed our structural validator** (both the answer and its repair): concept tags as plain words or invented IDs, an analogy cited as evidence, narration segments of 223 and 303 characters (limit 160). The content itself was sound. Fixes, decided by Lucky:
    - **Validator:** every ID in `concepts` must be one of this turn's shortlist concepts (the requested concepts in the registry plus what the shortlisted items teach; none when the shortlist is empty), and every `evidence` ID a shortlist reading. Each error lists the valid IDs, so one repair can fix it.
    - **Repair feedback:** when the format check fails, narration length, concepts and evidence are still checked, so the repair hears every error at once (each reported once).
    - **Prompt (`professor.v1.md`):** states the 160-character limit per narration segment, that `concepts` are exact concept IDs from the shortlist's `concept_ids`, and that `evidence` holds reading IDs only. The shortlist block now lists `concept_ids` first and never drops them. The prompt is about 3,111 estimated tokens (was 2,987).

22. **After the first passing turn (it needed a repair for a 163-character segment), decided by Lucky:**
    - **Narration:** the prompt asks for at most 140 characters per segment; the validator's hard limit stays 160.
    - **Repair:** the repair now shows the model its previous answer (as escaped data) with every error, and asks it to keep the content and change only what the errors name. Before, it saw only the errors and rewrote from scratch, losing the analogy and the reading.
    - **Predictions:** a question that offers choices about an outcome must be a prediction (prompt kind "prediction" with the prediction object). Prompt rule only: code cannot tell an outcome question from another question with choices.
    - **The arm's own weight:** whenever torque on an arm or lever comes up, the narration says the arm's own weight counts, or asks only about the load's share. Prompt rule, plus an `arm_weight` automatic expectation on six bake-off scenarios (s01, s03, s05, c1, c3, j1).
    - **No meta-talk:** never mention tools, instructions, the shortlist or the system. Prompt rule, plus a `meta_talk` phrase list in `config/pedagogy-phrases.json` checked like flattery (exact phrases only). Cause of "I can only explain the second half with my tools": the learner asked two things, the shortlist covered only one (torque, not what a servo is), and the "use only the shortlist" and "say it is not supported" rules together made the model announce the limit, calling the shortlist its tools.
    - **Analogies:** if the answer sets an analogy, the narration must say what maps to what and where it breaks down. Prompt rule, plus a heuristic check that is a **warning**, not a rejection (decision 23).

23. **Code rejects only objective violations; semantic checks are warnings plus transcript review** (Lucky, after the analogy check wrongly rejected a good answer that described a wrench but not a "bolt"):
    - **Rejections (hard checks):** IDs, bounds, lengths, counts, numbers outside placeholders, question placement, and the order of moves (the pedagogy rules).
    - **Warnings (never a rejection):** whether the narration explains a tagged analogy (a word from its title or mapping, and a breakdown phrase). Listed in the bake-off transcript and counted in its summary.
    - **Expectations (bake-off only, never a rejection):** for example `arm_weight` (the arm's own weight is mentioned, the load's share asked, or a calculation includes the arm's mass).
    - Tone, physics and teaching quality are judged by reading the transcripts.
    - The repair message now says that anything added must fit within the four segments.
    - **Predictions:** no code check (a "Not sure" chip does not mean an outcome question). Instead the prompt carries one worked example of a prediction prompt (about 3,457 estimated tokens in total).

24. **After the first 5-turn check stopped (Oct 12 2026), decided by Lucky:**
    - **The professor now sees the real teaching state:** open predictions (id, question, choices), open items, waivers, and the open prompt's text, kind and choices. They had been sent as fixed empty lists since slice 3, so the model could not know a prediction was still waiting. A test fails if they are hard-coded again.
    - **An open prediction the learner has not answered** is kept open: Aili answers what they said in one sentence and re-offers the same question more simply (same kind and choices; the id is kept, decision 25). The one-open-question rule allows exactly this re-offer; any new question is still rejected.
    - **Learner level "unknown"** (a goal statement): one baseline question finds the level. Scenario s02 uses it.
    - **Scripted scenario replies** may say what Aili's previous answer must be (`after`). If it no longer fits, the bake-off reports "script diverged" and skips the rest of that scenario; this is not a professor failure.
    - **Mild praise** ("that's a fine start") is a warning only (`flattery_warn`), never a rejection.

25. **After the first full bake-off (Oct 13 2026; stopped after 10 scenarios, 7 needed a repair or failed), decided by Lucky:**
    - **Predictions are recorded by the engine.** The director's answer has no prediction object any more (adding a question and choices to it made the schema too large to compile). A prompt of kind "prediction" makes the engine record the prediction: id `p-turn-N`, concept = the first of the answer's `concepts`, which the prompt asks to list first. A prediction prompt with no concepts is rejected. A re-offer (same kind and choices) keeps the id. Reveals and session_state use the engine's ids. A prediction can no longer arrive without its prompt, so the prompt-re-attach fallback was removed.
    - **Narration over 200 characters** is split by the engine at sentence ends (never inside a placeholder) into parts of at most 200, with a warning; one over-long sentence, or a split that would pass four segments, is rejected as before.
    - **"Not sure" / "I don't know" to a prediction is not a guess** (behavior spec A1a: "no idea" is a valid commitment, then explain): the prediction closes as `unsure`, no reveal or calculation is required, and Aili explains; the help ladder is for repeated "I don't know" (A4, A6).
    - **Count adjectives are not numbers:** a fixed list (N-axis, N-DOF, N-link, N-wheel(ed), N-joint, with N one digit; plus 3D/2D). Nothing the learner typed is exempted.
    - **Report:** "most questions in a row" resets per scenario; the summary groups results by scenario family and gives the first-attempt pass rate with and without the f and o families.

26. **After the frustration fixes (Oct 13 2026), decided by Lucky:**
    - **Frustration releases the open question** (spec A4): a frustrated reply while a question is open closes it ("released"), so a simpler new question is allowed. The router counts very short confused replies ("huh", "?", "what") as frustrated (spec A5).
    - **Direct answers:** the router flags `wants_direct_answer` ("just tell me", "no questions", a plain factual question). That turn is checked under the Answer-posture rules: no prompt, no prediction, assumptions stated and a source cited; an offer may be stated, never asked.
    - **Backlog (a later decision, tied to spec A2):** a session-level posture switch (Learning to Answer) when the learner keeps asking for direct answers. Spec A2 has posture confirmed with the learner; not built.
    - **Prompt:** a prompt contains exactly one question mark, no "does that make sense?" checks.
    - **Bake-off stop check:** the leaked-number stop uses the validator's own number check and allow-list.

27. **After the 19-scenario bake-off (Oct 13 2026), decided by Lucky:**
    - **`wants_direct_answer` for explicit requests only** ("just tell me", "no questions", "skip the explanation"). The earlier "plain factual question" set it on 10 turns, nine of them wrongly (decision 26).
    - **Direct-answer assumptions** are required only when the answer explains or calculates, not for a coverage-unsupported answer.
    - **"ROS 2" and "ROS2"** are allowed as product names; part numbers and model codes stay rejected.
    - **Unsupported topic:** coverage "unsupported" requires move "answer" or "explain" (spec A4, A14 test 11; o1 had used "hold").
    - **Teach-back application question:** the prompt is the guide's question word for word, any lead-in in narration; if the repair still paraphrases it, the engine uses the guide's exact text with a warning ("guide question substituted").

28. **After the 12-scenario bake-off (Oct 13 2026; 96.1% after repair across all 28), decided by Lucky:**
    - **Calculation IDs (s04):** "c1", "c2" in learner text is rejected and named as such; the prompt says results appear only through placeholders.
    - **Teach-back reading (s08):** a teach-back question must name its reading; with exactly one reading open the engine fills it in (warning "reading filled in"); otherwise the validator rejects it.
    - **Open reading reminder (s07):** naming the already-open reading again is a reminder, not another assignment. The prompt describes the path when an unlisted source is asked for while a reading is open: "I can't verify that", point back to the open reading in narration, re-offer the open question or ask none.

29. **After run A and the consistency check (Oct 13 2026), decided by Lucky:**
    - **A guess on an open prediction is never pushback:** the engine ignores the router's pushback flag when a guess is set (the s04 and c1 failures came from the hold rule and the prediction rule demanding opposite moves).
    - **A teach-back question on the open reading** follows up the question asked when the reading was assigned, and replaces it (s08).
    - **reveal.calc** must be one calculation ID, with an exact repair message.

## Design summary

- **Provider adapter:**
  - Interface: `ProfessorProvider.complete({ system, input, outputSchema, maxOutputTokens, signal })` returns `{ json, usage, latencyMs }`.
  - Provider, model, `api_key_env` (the variable *name*) and `max_output_tokens` live only in `config/ai.json`. A grep test keeps provider and model names out of code.
  - Structured output uses the director schema as JSON Schema, and our validators still run on everything.
  - One budget per turn, from config (`turn_timeout_ms`, 45 s for the first live run; each attempt at most `attempt_timeout_ms`, 30 s):
    - network errors, timeouts, 429 and 5xx get one retry with jittered back-off if time remains;
    - 401/403 means "key rejected", with no retry;
    - other 4xx map to `director`, with no retry;
    - a response that fails our validators gets one repair attempt with the errors fed back, then `validation`;
    - an interrupt aborts at once.
  - Every attempt is metered. A recorded adapter replays stored responses in CI.
- **Keys:**
  - The key lives in `apps/web/.env.local`, entered by Lucky. Claude never reads, prints or logs it.
  - The server reads it at call time and reports only whether it is present.
  - Tests plant a fake key and check it never appears in events, errors, logs or responses.
  - With no key: "Live answers aren't set up on this computer. Prepared lessons still work."
- **Spend:**
  - Worst-case check before each turn: cost so far + (estimated input tokens + max output tokens) × 2 attempts, at config prices, must fit within the session cap.
  - Live turns are refused until `provider_monthly_limit_set { by, on, usd }` is filled in by Lucky.
  - The kill switch stops the router too.
- **Teaching:**
  - Server-side session state (slice 1).
  - A router classifies each reply (`ReplyClassification`): whether it answers the open question, pushback, new evidence, frustration (including "just tell me"), a request for another example, an explicit acknowledgement, the guess for an open prediction, a request to stop, and a source the learner names.
  - Posture is chosen from the first message and confirmed with one tap.
  - The prompt template, `content/prompts/professor.v1.md`, is reviewed by Lucky; input is budgeted at 5,000 *estimated* tokens (characters ÷ 3.5), so about 6k by a real tokenizer.
  - Prediction → test → reveal order, teach-back against the human-written guide, verified readings only, waivers, and open items.

## Slices

| # | Slice | Needs from Lucky |
|---|---|---|
| 1 | Server-side session state (in memory) and a fake router; the client stops sending history | — |
| 2 | Provider interface, recorded adapter, retry/timeout/error mapping, config fields, the "no provider or model in code" grep | — |
| 3 | Prompt template and assembly, output JSON Schema, token budgeting | Review `professor.v1.md` |
| 4 | Worst-case spend check, key-presence check, no-key refusal, provider-limit gate, key-leak tests | — |
| 5 | Prediction→test→reveal, teach-back, readings, waivers, open items, validator extensions, the 17 CI tests (two sessions) | — |
| 6 | Real provider adapters with plain HTTP, code only, no key | Approval if an SDK turns out to be needed |
| 7a | Provider-backed router, dry run, bake-off harness (recorded and live modes), config for the first live run; no key, no call | Approve the config and the dry-run printout |
| 7b | Local-only live run: smoke test (1 turn), then up to 5 turns, then the bake-off; results report with measured latency; stop at any unexpected error | Key in `.env.local`; provider limit set and recorded |

## Gaps (stated plainly)

- **Session state and the ledger are in memory:** both are lost on restart and separate per server instance. Per-user and global caps need the database.
- **Real-model transcripts need a robotics reviewer to check the physics.** Lucky reviews the pedagogy only.
- **Some spec tests can only be checked with a real model:** 10 (invented references), and the content of 5, 8, 9 and 17. CI proves the rules and plumbing, not the behaviour.
- **Nothing is published yet**, so live turns use test fixtures until M4.
