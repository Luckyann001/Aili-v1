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

It returns `errors` (objective violations: the answer is rejected and gets one repair) and
`warnings` (semantic heuristics: never a rejection; listed in bake-off transcripts for review).

| Rule (added after the first live runs, 2026-10-12) | Kind | Checks |
|---|---|---|
| something for the learner | error | an answer with no narration and no prompt (actions alone) is rejected: "the answer gives the learner nothing"; counted in the bake-off summary as empty first answers |
| a probe asks | error | move `probe` requires a `prompt` (behavior spec A1a: one short question) |
| narration length | error / **warning** | at most 4 segments of at most **200** characters (error); a segment over 160 is a warning; the prompt asks for 140 |
| narration split | **warning** (engine) | a segment over 200 is split at sentence ends (a ".", "!" or "?" followed by a space, never inside a `{{placeholder}}`) into parts of at most 200, before validation. The split may make up to **five** segments if the whole narration is at most **700** characters (the model's own answers stay at four). Not split, and rejected as before, if one sentence alone is over 200, or the split would pass five segments or 700 characters |
| count adjectives and names | allowed digits | a fixed list: `N-axis`, `N-DOF`/`N DOF`, `N-link`, `N-wheel(ed)`, `N-joint` (N a single digit 1–9, never after a digit or decimal point), plus `3D`/`2D` and exactly `ROS 2`/`ROS2`. Part numbers and model codes (SG90, MG996R) stay rejected; nothing the learner typed is exempted |
| unsupported topic | error | coverage `unsupported` requires move `answer` or `explain` (behavior spec A4, A14 test 11) |
| calculation ID in text | error | "c1", "c2" in learner text is rejected as "calculation ID in text" (not as a hard-coded number); results appear only through placeholders |
| teach-back question names its reading | error / **warning** (engine) | move `teach_back` with a prompt and no grading must set `reading`; with exactly one reading open the engine fills it in ("reading filled in", counted in the summary); with none or several the validator rejects it |
| open reading reminder | pedagogy | naming the already-open reading again (move `assign`) is a reminder, not another item, and is not recorded twice; a different reading while one is open is still rejected (`open-items`) |
| guide application question | error / **warning** (engine) | after a teach-back that covers the guide, the prompt is the guide's application question word for word (a lead-in goes in narration). If the repair still paraphrases it, the engine uses the guide's exact text and logs "guide question substituted", counted in the bake-off summary |
| concepts | error | each ID is one of this turn's shortlist concepts (`Shortlist.concepts`); the error lists the valid IDs |
| evidence | error | each ID is a shortlist reading; the error lists the valid reading IDs |
| predictions (2026-10-13) | engine / error | there is no prediction object in the answer: a prompt of kind `prediction` makes the **engine** record the prediction, id `p-turn-N` and concept = the first of `concepts`; a prediction prompt with no concepts is an error. A re-offer (an open prediction with the same kind and choices) keeps its id. Reveals and `session_state` use the engine's ids |
| actions | error | the provider schema is flattened, so the strict action union checks each action's required fields, field types, no foreign fields, no unknown type |
| mild praise | **warning** | `flattery_warn` phrases in `config/pedagogy-phrases.json` ("a fine start"); never a rejection. The prompt also says not to open with a judgement of the learner's background or answer |
| numbers in assumptions and limitations | prompt rule | written in words ("level", "no payload"); the number validator is unchanged and still rejects digits there |
| "Not sure" to a prediction | engine rule | "Not sure", "I don't know", "idk", "No idea" close the prediction as `unsure` (not a guess): no reveal or calculation is required; the prompt says explain, and move up the help ladder on repeated "I don't know" (behavior spec A1a, A4, A6) |
| direct answer asked for | error (pedagogy) | the router flags `wants_direct_answer` for explicit requests only ("just tell me", "no questions", "skip the explanation"; an ordinary or factual question, or a reading request, does not set it): that turn is checked under the Answer-posture rules (no quiz or challenge move, no prediction) plus `direct-answer`: no prompt; assumptions stated when the answer explains or calculates (not for a coverage-unsupported answer); a source cited when the library has one. An offer may be stated in narration, never asked. The flag is shown to the director as `direct_answer_requested`; the session posture does not change |
| one question mark | prompt rule | a prompt contains exactly one question mark, no "does that make sense?" checks (the validator rule on question marks is unchanged) |
| frustration releases the open question | engine rule | a frustrated reply (router flag) while a question is open releases it: the history entry gets `released_prompt`, an open prediction gets status `released` and leaves the open items, so a simpler new question is allowed (behavior spec A4). The router counts very short confused replies ("huh", "?", "what") as frustrated (spec A5) |
| leaked-number stop (bake-off) | stop rule | uses the validator's own `checkNarration` (same allow-list), not a separate digit test |
| no pushback on a first turn, or on a guess | engine rule | the router's `pushback: true` is ignored when there is no earlier Aili turn (nothing to push against), and whenever the reply is a guess on an open prediction (a guess is tested and revealed, not held against); otherwise the hold-under-pushback rule applies as before |
| a reply that is exactly a choice | engine rule | a reply that equals one of the open prompt's choice labels (ignoring case and punctuation) is that choice: answered, a guess, and never frustration or pushback, whatever the router read (Lucky's decision 2026-10-13, after "Easier" was read as "make it simpler"). Anything else ("simpler please", "easier, I think") is left to the router |
| scene selected by engine | engine fallback | after the checks pass, if the answer selected no scene: (a) its first concept has a scene in this turn's shortlist (the registry's `teaches` link) and that scene is not already on stage → the engine selects it (Lucky's decision 2026-10-13); (b) STARTING SCENE FOR THE TOPIC: the answer names no concept (a level question, say) and no scene is on stage yet → the scene that teaches the topic's top concept (this turn's concepts that are in its shortlist, in order; never guessed) goes on stage (Lucky's decision 2026-10-14). Never for an unsupported topic, an empty shortlist, a top concept with no scene, or when a scene is on stage. Always a visible warning, marked "starting scene for the topic" for (b), counted in the bake-off summary. Narration that mentions a highlight is checked by the highlight rule below |
| a highlight must be on stage | validator (rejected for repair) | narration that says "highlighted", "highlight" or "the marked part" (only these words) needs a highlight_part action in the answer, or a highlight still active from an earlier turn (the session keeps the highlighted part; a new scene clears it); otherwise the answer is rejected with a plain message naming the word (Lucky's decision 2026-10-14) |
| stray action field dropped | engine fallback | before the checks, a field that belongs to ANOTHER action type (the provider's flattened schema lets the model add, say, "scene" to highlight_part) is dropped, only when the rest of that action is valid for its own type; each drop is a visible warning, counted in the bake-off summary. Unknown fields and otherwise invalid actions are left for the checks (Lucky's decision 2026-10-13) |
| every check, every time | engine rule | when the format check fails, the remaining validator checks and the teaching rules still run, on a lenient copy with the failing parts set aside (used only to find errors, never shown), so one repair prompt lists every problem together; a field already reported is not reported twice (Lucky's decision 2026-10-13, after the live "robotics" turn failed twice) |
| level not stated; no words put in the learner's mouth | engine rule + warning | a session starts at learner_level "unknown", and the professor's session state says it was "not stated by the learner"; the prompt says never to claim the learner said something they did not write. Warning "unsupported attribution" (never a rejection): on the FIRST turn, narration that says "you said / you told me / you mentioned …" with words the learner's message does not contain. Later turns cannot be checked: the engine keeps earlier replies as flags, not words (Lucky's decision 2026-10-13, after "You said you know some robotics") |
| reveal.calc | error | one calculation ID of this turn, such as "c2"; a list or phrase ("c1 and c2") is rejected with an exact message |
| one open question | error (pedagogy) | no new prompt while one is open. Exceptions: a teach-back question on the open reading follows up (and replaces) the question asked when that reading was assigned; and re-offering the open question itself: the same kind and the same choices as the stored open prompt (a prediction or a plain question; the text may be reworded; a prediction keeps its id). Every re-offer is a **warning**, "open question re-offered", counted in the bake-off summary |
| analogy explained | **warning** | a tagged analogy's narration has a word from its title or mapping and a breakdown phrase (breaks down, unlike, differs, doesn't hold, not like, but a servo, whereas) |
| every error at once | — | when the format check fails, narration length, concepts and evidence are still checked; the repair gets every error and the previous answer, and is told to keep the content but add what the errors name, within four segments |

The professor's `<session_state>` carries the real teaching state: open predictions (id, question,
choices, status, guess), open items, waivers, and the open prompt's text, kind and choices.
Learner level `unknown` (a goal statement) is not a true beginner: one plain baseline question first.
The router also sees the open question (text, kind, choices) and is told that a short or partial reply
on its topic counts as an answer. The bake-off logs the router's `answered_prompt` verdict on every
turn and counts turns where it called a scripted direct answer (`direct_answer`) unanswered.
In the bake-off, a scripted reply can declare what Aili's previous answer must be (`after`); if it
no longer fits, the scenario reports "script diverged" and skips the rest (not a professor failure).

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
- **One budget per turn** (`turn_timeout_ms` in config, 45 s; each attempt at most `attempt_timeout_ms`, 30 s; router, director, retries and the repair share it). Network error,
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

## Anthropic adapter (`src/providers/`, slice 6; code only, no real call yet)
- `createProfessorProvider(config, model, env)` picks the adapter named in `config/ai.json`; an
  unknown provider answers `not_configured`. Provider names may appear only in `src/providers/`;
  model IDs appear nowhere in code (both checked by a test).
- **Plain `fetch`, no SDK.** `POST /v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`.
  The key is read from the variable NAMED in config at call time and goes only into that header;
  redirects are refused; a non-https address is refused unless it is this computer (tests).
- **Structured output** (`output_config.format`, `json_schema`): the director schema is sent in a
  reduced form, because the API rejects some JSON Schema features (lengths, numeric bounds, `minItems`
  above 1, open objects). The calc `inputs` map goes as `{ name, value }` pairs and is turned back.
  Our validators still enforce the full rules. `thinking` and `effort` are sent only if config sets
  them (thinking tokens count toward `max_output_tokens`).
- **Errors**: 401/403 `key_rejected`; a monthly spending limit (HTTP 400 "You have reached your
  specified … API usage limits", or 429 with `enforced_spend_limit_reached`) `spend_limit`, not
  retried; other 429, 5xx and 529 retried once; other 4xx `bad_request` (turn reason `director`);
  `stop_reason: "refusal"` is `refused` (billed, metered). The response body never leaves the adapter.
- **Usage**: input (including cache reads and writes) and output tokens as reported; absent, the
  attempt is metered conservatively. Invalid or truncated JSON returns `null`, so the repair runs.
- **Tests** run against a local mock server on 127.0.0.1 with hand-written fixtures derived from
  the docs (`src/providers/__fixtures__/`), not real responses.

## Provider-backed router (`src/providerRouter.ts`, `content/prompts/router.v1.md`; slice 7a)
- The router model from `config/ai.json`, through the same adapters and retry rules as the director.
  Classification output only (`ReplyClassification` as JSON Schema); the learner's text and a small
  session state go in escaped DATA blocks. No repair attempt: an invalid classification fails the
  turn as `router`. Each attempt is metered at router prices as it ends. A rejected key, a spending
  limit or a refusal keep their own reason. `router.v1.md` is a draft for Lucky's review.
- The fake router stays for CI and the demo.

## Dry run (`scripts/dryRun.ts`; slice 7a)
`npm run dry-run -w @aili/engine -- [--text "…"] [--show-prompt] [--preview-provider NAME] [--professor-model ID] [--router-model ID]`
builds the router's and the professor's request for one turn through the real adapter, with a
fetch that records and stops: nothing is sent, no key is read (a placeholder goes in, and the
`x-api-key` header is masked in the output). Prints the model, max_tokens, thinking, effort, the
estimated input tokens, the headers and the reduced output schema. The preview flags show the
request as if config held those values; config is not changed.

## Bake-off (`src/bakeoff/`, `scripts/bakeoff.ts`, `bakeoff/`; slice 7a)
- **Scenarios** (`bakeoff/scenarios/`, 28): behavior spec A14 tests 1–11, 13 and 15–17 (12 and 14
  are fully checked by code and need no model), 5 confident-but-wrong, 3 frustration, 2 out of
  coverage, 2 safety, 1 "just tell me". Each has the few expectations code can check (move,
  question, coverage, safety flag, reading) and `reviewer_notes` for the rest. They run against
  the **test-fixture registry** (two concepts, two readings, two analogies), so many exercise the
  "not supported yet" path.
- **Recorded mode** (`npm run bakeoff -w @aili/engine`): replays `bakeoff/recordings/<id>.json`;
  no model, key or network. Only two hand-written recordings exist; other scenarios are skipped.
- **Live mode** (`npm run bakeoff:live -w @aili/engine -- …`): node loads
  `apps/web/.env.local` itself (the script never reads, prints or stores a key). Refuses to start
  without `provider_monthly_limit_set`, both models and both keys, or with the kill switch on.
  `--record` keeps the answers (never requests or keys) in `recordings-for-review/`, kept only after review.
- **Hard cap**: `bakeoff_cap_micro_usd` (3 USD), checked before every turn against everything spent
  plus the next turn's worst case. A transport retry inside a turn can still add a little beyond it;
  the provider's own monthly limit is the real ceiling. **Stops at the first unexpected failure**
  unless `--keep-going`. `--scenario a,b`, `--category`, `--runs N`, `--max-turns N`.
- **Output** (`bakeoff-runs/<time>-<mode>/`, git-ignored): `summary.md` (pass rates first try and
  after repair, expectations, latency median and slowest 5%, cost from the ledger, moves, explains
  per question, most questions in a row), `results.json`, one transcript per scenario run.

## Prompt (`src/prompt.ts`, `content/prompts/professor.v1.md`)
- **System prompt**: the versioned template with its review comments (one per rule, naming the spec
  section) removed. The template is a draft for Lucky's review.
- **Input**: three tagged DATA blocks, `<shortlist>` (compact: IDs, settings with bounds, solver
  inputs/outputs, analogy mappings and where they break down, reading guides), `<session_state>`
  (posture, level, open prompt, last moves; predictions and open items from slice 5) and
  `<learner_input>`. `<` and `>` are escaped inside them, so no text can close or open a block.
- **Budget**: 5,000 ESTIMATED tokens (characters ÷ 3.5; no provider tokenizer offline), so a real
  tokenizer counting up to about 20% more still stays under 6,000.
  Over budget, whole items are dropped lowest rank first: readings, analogies, scenes not on stage,
  unused solvers, simulations. Never dropped: the scene on stage and any item with safety notes;
  kept items keep their bounds. The model is told what was left out. `overBudget` is reported if
  even that is not enough.
- **Output schema**: generated from the Zod director-response schema (`z.toJSONSchema`).

## Metering, cap and kill switch (`src/metering.ts`)
- **Prices only from `config/ai.json`** (validated by `AiConfig`): integer micro-USD per million
  tokens for the professor and the router. The current prices are **test values, not real pricing**.
  A test greps every source file for the configured numbers.
- **Cost** is exact integer arithmetic, rounded up per direction, so a cap is never passed by rounding.
- **Before each turn, before anything is called** (router included), in order:
  1. `AILI_AI_KILL_SWITCH=1` (server env, read per request);
  2. live turns only: a provider, model and key (presence only, `keyPresent`) for both models,
     otherwise `not_configured`;
  3. live turns only: `provider_monthly_limit_set` recorded in config (by Lucky, after setting the
     provider's limit; Claude cannot check the dashboard), otherwise `limit_not_recorded`;
  4. the worst case: cost so far + 2 × (estimated input + max output) for the professor and the
     router, at config prices, must fit `session_cap_micro_usd`, otherwise `session_cap`.
  Each says so in plain words and keeps the last valid state. Fake-director demo turns are not
  live, so 2 and 3 do not apply to them.
- **Estimates**: the provider-backed director reports its assembled prompt's estimate; otherwise the
  full prompt budget (5,000) and a 1,000-token router allowance are assumed. The worst case counts
  two attempts (the answer and its repair); a transport retry inside either is metered when it
  happens but is not in the pre-turn check.
- **Each provider attempt is metered as it ends**, even after the turn has timed out or been
  interrupted. A timed-out or aborted attempt is charged its estimated input + max output (the
  provider may still bill it); 429, 5xx and other refusals are charged zero; a request that never
  reached a provider (no key, no config) is not metered at all. A connection lost *after* the request
  was sent (`network`) is charged like a timeout; one that never left (`unreachable`: refused, DNS) is zero.
- **Why the pre-turn check counts two attempts, not four**: a transport retry inside either call is
  metered when it happens, so the ledger stays right; and the provider's own monthly limit, set by
  Lucky, is the real ceiling.
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
| no-meta-talk (2026-10-12) | the `meta_talk` phrases (my tools, my instructions, the shortlist, system prompt, …) | paraphrases; see below |
| hold-under-pushback | pushback without new evidence → move `hold` | whether the earlier position was correct, whether the reply was pushback, whether the narration keeps the position; left to the M3 professor tests (behavior spec test 5) |

### Slice 5a rules (teaching state on the server)
| Rule | Checks |
|---|---|
| test-after-prediction | after the learner commits a guess: a calculation, a `reveal` of that prediction, move `explain` |
| reveal-after-guess | a reveal only for a prediction the learner has guessed, and only once |
| one-probe-before-explain | no second probe on a concept before an explanation |
| back-off-on-frustration | after "I don't know" / "just tell me": `explain` or `answer` |
| another-example | after "another example": an `analogy` from the shortlist not used before |
| open-items | at most 3 open items; no new reading while one is open |
| waiver-acknowledgement | a safety-critical waiver asks for explicit acknowledgement (and sets `safety`); nothing goes on until the learner gives it |
| (5b) teach-back-graded | a teach-back answer is graded in `teach_back_check`, only with the guide's exact key claims and misconceptions; a vague answer gets a follow-up question, a good one the guide's application question; no verdict, score or mastery field exists |
| (5b) unverified-source | a source the learner names that is not in the library: "I can't verify that", plus the nearest library item |
| (5b) debate-announce / -rounds / -stop / -concede | announced "on purpose", at most 3 rounds, stops on request, concedes on evidence |
| (5b) coverage | an empty shortlist needs `coverage: "unsupported"`; an unsupported topic changes nothing on stage |
| (5b) answer-posture | also: no prediction quiz; a calculated answer states assumptions and cites a source |
| safety_critical | a waiver or reading touching a flagged concept or item needs explicit acknowledgement, whatever the director declares (build steps from M5; M4 flags the concepts) |

Predictions (guess, result), open items, waivers (who acknowledged, and the date) and the analogies
used live in `SessionState.teaching` on the server, change only when a turn completes, and are lost
on restart until the database stage.

### Limits of a phrase list
- It matches only the listed wordings (whole words, any case, straight or curly apostrophes).
  Paraphrases ("what a question!", "you've nailed it") pass unless they are added.
- It cannot read intent. A check question that uses a listed phrase ("Do you now understand why")
  is flagged the same as a claim; the test suite records this as a known false positive.
- Near-misses that share words but not the phrase pass ("a great deal of torque").
- It checks Aili's own text (narration, prompt, assumptions, limitations), not the learner's chips.
- The list is a floor, not a judge of tone. The M3 professor tests check flattery and mastery
  claims in real sessions. Change the list only with review.
