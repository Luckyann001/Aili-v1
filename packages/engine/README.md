# @aili/engine

The deterministic parts of a turn: the capability registry and shortlist, the director-response
validators, the beat validator for prepared lessons, and the stale-action gate. No AI provider,
no network.

## Registry and shortlist (`src/capabilities.ts`)
`loadRegistry` validates the whole bundle (concepts, scenes, solvers, simulations, analogies,
sources, readings) or returns errors and no registry. Test fixtures load only when allowed (dev);
production refuses them. `shortlist(concepts, level)` returns published items only.

## Structural validator (`src/director.ts`)
`validateDirectorResponse` checks one response against this turn's shortlist: IDs, bounds and unit
fields, verified evidence, numbers only through `{{calc.output}}` placeholders from this turn, a
question only in `prompt`, and narration caps. Errors name the exact field and value.

## One turn (`src/turn.ts`, `src/fakeDirector.ts`)
`TurnSession.run(input, emit)`: shortlist → director → structural validator → pedagogy validator →
solvers → compile (placeholders filled, three significant figures) → events.
- **Events**, in order: `turn.started`, `narration`, `action`, `calc.result`, `prompt`, `turn.done`;
  or `turn.started` then `turn.error`. Each carries `turn_id`, `seq` and `rev`.
- **No partial turns**: everything that can fail runs before any content event. A failure emits
  `turn.error` (plain words for the learner, `details` for developers) and keeps the last valid state.
- **Stale events**: a new turn or `interrupt()` bumps the revision and aborts the director; events
  from an older revision are dropped before they reach `emit`. The client's gate (`admit`) drops
  late ones again.
- **Director**: an interface. M2 has only `createFakeDirector` (scripted cases: valid, invalid-id,
  out-of-bounds, hard-coded-number, pedagogy-violation, solver-failure, slow). It answers from the
  test-fixture shortlist, so it works only with the dev fixture registry. No provider, key or network.
- **State** (`SessionState`: history, open prompt, scene on stage) lives on the **server**, in
  `InMemorySessionStore` keyed by page session (bounded, idle sessions forgotten). Only a completed
  turn commits, and never over a newer one. The client sends only its text (M3 hard rule). In
  memory only: lost on restart and separate per server instance until the database stage.
- **Router** (`src/router.ts`): classifies each reply on the server (answered, pushback, new
  evidence); its output is validated and metered at router prices. M3 slice 1 has only the fake
  router, with fixed rules; the real one is a cheap model.

## Provider adapter (`src/provider.ts`, `src/providerDirector.ts`, `src/recordedProvider.ts`)
- `ProfessorProvider.complete({ system, input, outputSchema, maxOutputTokens, signal })` →
  `{ json, usage, latencyMs }`. Provider, model, the key's variable NAME (`api_key_env`) and
  `max_output_tokens` live only in `config/ai.json`; a test greps the code for provider and model names.
- **One 20 s budget per turn** (router, director, retries and the repair share it). Network error,
  attempt timeout, 429 and 5xx get ONE jittered retry (250–750 ms) if at least 2 s remain; 401/403
  is `key_rejected` and other 4xx fail at once; an interrupt aborts the request at once.
- **One repair attempt**: an answer that fails the structural or pedagogy checks is sent back with
  the errors, once. Every attempt (retries and the repair included) is metered.
- **Errors** become `turn.error` reasons (`not_configured`, `key_rejected`, `timeout`, `director`,
  `validation`, `pedagogy`); `details` carry a kind only, never a key or a provider's response body.
- **`not_configured`** when the config has no provider or model, or no key is set (only its presence
  is checked; the value never enters the engine).
- **`RecordedProvider`** replays stored steps (`src/__recordings__/`), so CI needs no key or network.
  The current recording is hand-written; real recordings come in slice 7, reviewed before they are kept.
  The real HTTP adapters are slice 6.

## Metering, cap and kill switch (`src/metering.ts`)
- **Prices only from `config/ai.json`** (validated by `AiConfig`): integer micro-USD per million
  tokens for the professor and the router. The current prices are **test values, not real pricing**.
  A test greps every source file for the configured numbers.
- **Cost** is exact integer arithmetic, rounded up per direction, so a cap is never passed by rounding.
- **Before each turn**: `AILI_AI_KILL_SWITCH=1` (server env, read per request) refuses it; then a
  page session that has reached `session_cap_micro_usd` is refused. Both say so in plain words and
  keep the last valid state; the director is not called.
- **After the director answers**, its token usage is recorded, even if the response then fails a check.
- **The ledger is in memory only**: lost on restart, separate per server instance, keyed by page
  session. **Per-user and global caps (and daily limits, rate limits, spike alerts) need the
  database** (deferred stage) and M7. Voice and hosting costs are 0 in config: not metered yet.

## Pedagogy validator (`src/pedagogy.ts`)
`validatePedagogy(response, history)` checks a response against the session history
(`SessionHistory` in `@aili/schemas`). Errors read `rule <name> (turn N): …`.

| Rule | Checks | Cannot check |
|---|---|---|
| one-open-question | no new prompt while the last one is unanswered | whether the learner's reply really answered it (a classification made outside) |
| give-before-asking-again | a second question in a row must come with narration, a result or a visual | whether that narration is substantial |
| explain-after-probe | after a probe is answered, the move is `explain` (safety excepted) | the quality of the explanation |
| explain-first-for-beginners | a true beginner's first probe on a concept follows an `explain` turn on it | whether that turn really explained the concept (it relies on the `concepts` each turn declares) |
| challenge-budget | at most one non-safety challenge in any three turns | whether `safety: true` was justified |
| answer-posture | no quiz or challenge moves in the Answer posture (a safety challenge is allowed) | — |
| no-flattery, no-mastery-claim | phrases from `config/pedagogy-phrases.json` | see below |
| hold-under-pushback | pushback without new evidence → move `hold` | whether the earlier position was correct, whether the reply was pushback, whether the narration keeps the position; left to the M3 professor tests (behavior spec test 5) |

### Limits of a phrase list
- It matches only the listed wordings (whole words, any case, straight or curly apostrophes).
  Paraphrases ("what a question!", "you've nailed it") pass unless they are added.
- It cannot read intent. A check question that uses a listed phrase ("Do you now understand why")
  is flagged the same as a claim; the test suite records this as a known false positive.
- Near-misses that share words but not the phrase pass ("a great deal of torque").
- It checks Aili's own text (narration, prompt, assumptions, limitations), not the learner's chips.
- The list is a floor, not a judge of tone. The M3 professor tests check flattery and mastery
  claims in real sessions. Change the list only with review.
