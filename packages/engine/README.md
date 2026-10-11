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
