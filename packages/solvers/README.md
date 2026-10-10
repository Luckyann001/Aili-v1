# @aili/solvers

Deterministic calculations. Every number Aili shows comes from here, never from the UI or the AI.
All internals are SI; every field name carries its unit (`lever_length_m`, `torque_nm`).
Each solver is tested against a worked example whose hand calculation is written out in the test.

## `relativeEffort` — holding a lever level (`src/leverEffort.ts`)

Used by the beginner lever analogy (M1 slice 4c) to drive an **illustrative, unitless** effort gauge.

**Assumptions** (state them wherever the result is shown):
- **Rigid, uniform lever** (a ruler): its own mass acts at its middle.
- **Static case**: held still and level; no acceleration or swinging.
- **Hand position**: the hand grips one end, and that end is the pivot moments are taken about.
- **Point weight**: the sliding weight is treated as a point at its distance from the hand.
- Gravity acts straight down; friction and bending are ignored.

**Model**: moment about the hand `M(d) = g · (m_weight · d + m_lever · L / 2)`;
relative effort `= M(d) / M(L)` (1 with the weight at the far end). The lever's own mass is always
included, so the effort never reaches zero.

**Does not cover**: how long a person (or a motor) can hold it, fatigue, heat, dynamic loads, or
any safety rating. It compares two positions; it is not a strength or sizing calculation.

**Worked example** (see `src/leverEffort.test.ts`): lever 0.30 m, 0.05 kg; weight 0.20 kg at 0.10 m
→ `0.0275 / 0.0675 = 0.40741`.
