# M3 plan: the live professor

**Status:** approved by Lucky on Oct 12 2026, with the decisions below. Built one slice at a time; each slice ends with a report, and the next waits for Lucky.
**Branch:** `m1/learn-stage-shell`. Local commits only: no push, no remote, no merge.

Read with: `CLAUDE.md`, `docs/aili-professor-behavior-spec.md` (A1–A14), `docs/m2-plan.md` (§9: session state on the server), `packages/engine/README.md`.

## Decisions (Oct 12 2026)

1. **Keys:** a real AI key may be used on Lucky's laptop only, never deployed and never on any hosting service, until the database stage. This is recorded in CLAUDE.md and the milestones doc.
2. **Budget:**
   - Provider monthly limit: **30 USD**, set by Lucky in the provider's dashboard and recorded in config.
   - Bake-off cap: **25 USD** in config.
   - The bake-off runs every scenario **once** on two pairings. The 3-run consistency check runs only for the winner, and only on the confident-but-wrong scenarios.
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

## Design summary

- **Provider adapter:**
  - Interface: `ProfessorProvider.complete({ system, input, outputSchema, maxOutputTokens, signal })` returns `{ json, usage, latencyMs }`.
  - Provider, model, `api_key_env` (the variable *name*) and `max_output_tokens` live only in `config/ai.json`. A grep test keeps provider and model names out of code.
  - Structured output uses the director schema as JSON Schema, and our validators still run on everything.
  - One 20-second budget per turn:
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
  - A router classifies each reply: answered, pushback, new evidence, intent or posture, "just tell me", and safety.
  - Posture is chosen from the first message and confirmed with one tap.
  - The prompt template, `content/prompts/professor.v1.md`, is reviewed by Lucky; input is budgeted at about 6k tokens.
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
| 7 | Local-only live run, bake-off harness, results report | Model names and prices re-checked; key in `.env.local`; provider limit set and recorded |

## Gaps (stated plainly)

- **Session state and the ledger are in memory:** both are lost on restart and separate per server instance. Per-user and global caps need the database.
- **Real-model transcripts need a robotics reviewer to check the physics.** Lucky reviews the pedagogy only.
- **Some spec tests can only be checked with a real model:** 10 (invented references), and the content of 5, 8, 9 and 17. CI proves the rules and plumbing, not the behaviour.
- **Nothing is published yet**, so live turns use test fixtures until M4.
