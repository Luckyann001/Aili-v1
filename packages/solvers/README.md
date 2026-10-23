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

## `staticTorqueSingleLink` — holding an arm still (`src/staticTorque.ts`)

`solver.static-torque-single-link`, used by `sim.servo-static-load` (draft).

**Angle convention:** θ is measured **from horizontal**: 0° is level (largest torque), 90° is straight up (none).

**Assumptions** (state them wherever the result is shown):
- **Static hold only**: no acceleration, friction or gear play.
- **Uniform arm**: its own mass (`arm_kg_per_m × arm_length_m`) acts at its middle. **Required, > 0.**
- **Point payload** at the tip; optional extra point masses at stated distances.
- **Extra masses may sit beyond the arm's end** (a held object, a gripper), up to 5 m from the joint.
- Gravity straight down.

**Model**: `τ = g · cos θ · (m_payload · L + m_arm · L/2 + Σ m_i · d_i)`. The result is also split
into `payload_torque_nm`, `arm_torque_nm` and `extra_torque_nm`, so the arm's own share is visible.

**Rating**: `share_of_rating` appears only when the learner supplies a datasheet rating, as either
`rated_stall_torque_nm` or `rated_continuous_torque_nm` (never both), and the result says which kind.
The solver never invents a rating.

**Input checks**: negative and non-finite values are rejected. Inputs with no physical upper limit
of their own have a documented **sanity cap** (`SANITY_CAPS` in `src/staticTorque.ts`): arm length 5 m,
payload 100 kg, arm 50 kg/m, extra mass 100 kg at up to 5 m from the joint, supplied rating 100 N·m (about 1,020 kgf·cm), and g
between 9.7 and 9.9 m/s² (textbook checks only). These are not physical limits; they catch typing and
unit mistakes. The simulation manifests set the tighter bounds a learner can use (the rating inputs
there use the same 100 N·m cap).

**Does not cover**: dynamic loads, duty cycle, heat, structural stress, control stability. A static
torque alone cannot show that a motor will overheat or a part will break.

**Checked against** (see `src/staticTorque.test.ts`):
- OpenStax *College Physics 2e* §9.6, Example 9.4: horizontal forearm with its own weight → biceps force 470 N
  (the book uses g = 9.80; with standard gravity the solver gives 470.7 N, within 0.2%).
- OpenStax *University Physics Volume 1* §12.2, Example 12.4: forearm at 60° to the vertical (weight
  neglected; checked on the payload share) → biceps tension 1927 N.
- A hand derivation, **not textbook**: 0.20 m arm, 0.25 kg/m, 0.30 kg payload, 30° → 0.5520325 N·m.
- Property tests: zero at 90°, cos θ fall-off, linear in payload, arm mass always counts, agrees with `relativeEffort`.

Both OpenStax books are licensed CC BY-NC-SA 4.0 (as stated on their pages); the tests quote only the
data and results needed, with attribution.
