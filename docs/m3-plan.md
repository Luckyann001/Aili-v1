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
