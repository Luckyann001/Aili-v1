import { describe, expect, it } from "vitest";
import { SANITY_CAPS, gravityMoment_nm, staticTorqueSingleLink } from "./staticTorque";
import { relativeEffort } from "./leverEffort";
import { STANDARD_GRAVITY_M_PER_S2, cosDeg, kgFromG, kgfCmFromNm, mFromCm, nmFromKgfCm, radFromDeg } from "./units";

// solver.static-torque-single-link. θ is measured FROM HORIZONTAL (0° level, 90° straight up).
//
// Textbook sources (opened and read on 2026-10-11; quotations below are copied from the pages):
//   [UP1] OpenStax, University Physics Volume 1 (Moebs, Ling, Sanny; 2016), §12.2 "Examples of
//         Static Equilibrium", Example 12.4 "Forces in the Forearm".
//         https://openstax.org/books/university-physics-volume-1/pages/12-2-examples-of-static-equilibrium
//   [CP2] OpenStax, College Physics 2e (Urone, Hinrichs; 2022), §9.6 "Forces and Torques in Muscles
//         and Joints", Example 9.4 "Muscles Exert Bigger Forces Than You Might Think".
//         https://openstax.org/books/college-physics-2e/pages/9-6-forces-and-torques-in-muscles-and-joints
//   Licence, quoted from each page's footer (both pages, 2026-10-11):
//     "© 1999-2026, Rice University. Except where otherwise noted, textbooks on this site are
//      licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY NC-SA) license."
//   Section URLs, quoted from each page's citation block:
//     [UP1] "Section URL: https://openstax.org/books/university-physics-volume-1/pages/12-2-examples-of-static-equilibrium"
//     [CP2] "Section URL: https://openstax.org/books/college-physics-2e/pages/9-6-forces-and-torques-in-muscles-and-joints"
//   Because the licence is non-commercial and share-alike, only short excerpts are quoted (the data
//   and results a test needs), never a full example. Prose excerpts are word for word. Equations on
//   the pages are MathML; marked "[eq …]" below, they are typeset by us from that markup (fraction
//   and product layout restored, symbols and numbers unchanged).

describe("textbook: [CP2] Example 9.4 — a horizontal forearm, its own weight included", () => {
  // "Calculate the force the biceps muscle must exert to hold the forearm and its load as shown in
  //  Figure 9.25, and compare this force with the weight of the forearm plus its load. You may take
  //  the data in the figure to be accurate to three significant figures."
  // Figure 9.25 alt text: "The upper part of the arm is vertical and the lower part is horizontal."
  // "Note that sinθ=1 for all forces, since θ=90º for all forces."
  // [eq 9.35]  r2·wa + r3·wb = r1·FB          (wa: forearm, wb: its load)
  // [eq 9.37]  FB = [(0.160 m)(2.50 kg)(9.80 m/s²) + (0.380 m)(4.00 kg)(9.80 m/s²)] / (0.0400 m)
  // [eq 9.38]  FB = 470 N.
  // "Now, the combined weight of the arm and its load is 6.50 kg × 9.80 m/s² = 63.7 N"   [eq inline]
  //
  // Mapping to our model: the forearm (2.50 kg, centre of gravity at r2 = 0.160 m) and the load
  // (4.00 kg at r3 = 0.380 m) are point masses on an arm held level (θ = 0° from horizontal).
  // Their gravity moment about the elbow is the left side of eq 9.35; dividing by r1 gives FB.
  // The book's forearm centre of gravity is not at its middle, so this checks gravityMoment_nm
  // (the primitive), not the uniform-bar assumption of staticTorqueSingleLink.
  const g = 9.8; // the book uses 9.80 m/s²
  const moment_nm = gravityMoment_nm(
    [
      { mass_kg: 2.5, distance_m: 0.16 },
      { mass_kg: 4.0, distance_m: 0.38 },
    ],
    0,
    g,
  );

  it("biceps force FB = moment / r1 = 470 N (three significant figures)", () => {
    expect(moment_nm / 0.04).toBeCloseTo(470.4, 6); // exact: 18.816 N·m ÷ 0.0400 m
    expect(Number((moment_nm / 0.04).toPrecision(3))).toBe(470);
  });

  it("the forearm's own weight is part of the moment (leaving it out gives the wrong answer)", () => {
    const loadOnly_nm = gravityMoment_nm([{ mass_kg: 4.0, distance_m: 0.38 }], 0, g);
    expect(Number((loadOnly_nm / 0.04).toPrecision(3))).not.toBe(470);
    expect(Number(((2.5 + 4.0) * g).toPrecision(3))).toBe(63.7); // combined weight, as in the book
  });
});

describe("textbook: [UP1] Example 12.4 — a tilted forearm, its own weight neglected", () => {
  // "A weightlifter is holding a 50.0-lb weight (equivalent to 222.4 N) with his forearm, as shown
  //  in Figure 12.11. His forearm is positioned at β=60° with respect to his upper arm."
  // "Assume that the forearm’s weight is negligible."
  // "The vertical direction is the direction of the weight, which is the same as the direction of
  //  the upper arm. The x-axis makes an angle β=60° with the vertical."
  // "The free-body diagram shows that the lever arms are rT=1.5in. and rw=13.0in."
  // [eq 12.23] +rT·Ty − rw·wy = 0,  with Ty = T·sinβ and wy = w·sinβ   (from the component list)
  // [eq 12.25] rT·T − rw·w = 0.
  // "In the final answer, we convert the forces into SI units of force. The answer is"
  // [eq]       T = 433.3 lb = 433.3(4.448 N) = 1927 N upward.
  //
  // Is the book's lever arm a perpendicular distance? No. The book says "We adopt the frame of
  // reference with the x-axis along the forearm" and that "the x-components of the forces are all
  // parallel to their lever arms", so rw = 13.0 in is measured ALONG the forearm, from the elbow to
  // the weight. The book takes the perpendicular part of the force instead: wy = w·sinβ, giving the
  // weight's moment rw·w·sinβ (eq 12.23). The perpendicular distance from the elbow to the weight's
  // vertical line of action would be rw·sinβ = 13.0 in × sin60° ≈ 11.3 in; the book never uses it.
  //
  // Mapping onto the solver's inputs:
  //   arm_length_m = rw, the distance along the arm (13.0 in × 0.0254 m/in = 0.3302 m; 1 in =
  //                  0.0254 m exactly, converted at this edge; the book notes the units cancel).
  //   angle_deg    = θ from horizontal. The upper arm is vertical and the forearm makes β = 60° with
  //                  it, so the forearm is 60° from vertical, i.e. θ = 90° − 60° = 30° from horizontal.
  //   The solver applies cos θ itself: g·m·L·cos30° = w·rw·sin60°, the book's moment exactly
  //   (cos30° = sin60°). So the along-the-arm length goes in, not a perpendicular distance.
  //   payload_kg   = w / g (the book gives w in newtons; g cancels).
  // The book neglects the forearm's weight; our solver always includes the arm's own mass, so the
  // check is on payload_torque_nm (the payload's share), reported separately. Then, from eq 12.23,
  // T = payload torque / (rT · sinβ), since Ty = T·sinβ acts at rT along the forearm too.
  const IN_M = 0.0254;
  const g = STANDARD_GRAVITY_M_PER_S2; // cancels: the book gives the weight in newtons
  const r = staticTorqueSingleLink({
    arm_length_m: 13.0 * IN_M,
    payload_kg: 222.4 / g,
    arm_kg_per_m: 0.1, // any value > 0; the book's case is checked on the payload share only
    angle_deg: 30,
  });

  it("biceps tension T = 1927 N", () => {
    const T_n = r.payload_torque_nm / (1.5 * IN_M * Math.sin(radFromDeg(60)));
    expect(T_n).toBeCloseTo(1927.4667, 3); // = 222.4 × 13.0 / 1.5
    expect(Math.round(T_n)).toBe(1927);
  });

  it("the arm's own share is reported separately and adds to the total", () => {
    expect(r.arm_torque_nm).toBeGreaterThan(0);
    expect(r.torque_nm).toBeCloseTo(r.payload_torque_nm + r.arm_torque_nm, 12);
  });
});

describe("hand derivation, not textbook: a tilted servo arm", () => {
  // Hand derivation, not textbook (written for this test; check it by hand).
  //   Arm 0.20 m long, 0.25 kg/m  → arm mass m_arm = 0.25 × 0.20 = 0.050 kg, acting at 0.10 m.
  //   Payload 0.30 kg at the tip (0.20 m). Arm at θ = 30° from horizontal.
  //   Σ m·d = 0.30 × 0.20 + 0.050 × 0.10 = 0.060 + 0.005 = 0.065 kg·m
  //   cos 30° = 0.8660254
  //   τ = g · cos θ · Σ m·d = 9.80665 × 0.8660254 × 0.065 = 0.5520325 N·m
  //     payload share = 9.80665 × 0.8660254 × 0.060 = 0.5095685 N·m
  //     arm share     = 9.80665 × 0.8660254 × 0.005 = 0.0424640 N·m
  //   In kgf·cm, g cancels: 0.065 × 0.8660254 × 100 = 5.629165 kgf·cm
  //   With a supplied stall rating of 2.0 N·m: share = 0.5520325 / 2.0 = 0.2760163
  const input = { arm_length_m: 0.2, payload_kg: 0.3, arm_kg_per_m: 0.25, angle_deg: 30 };

  it("matches the derivation", () => {
    const r = staticTorqueSingleLink(input);
    expect(r.torque_nm).toBeCloseTo(0.5520325, 6);
    expect(r.payload_torque_nm).toBeCloseTo(0.5095685, 6);
    expect(r.arm_torque_nm).toBeCloseTo(0.042464, 6);
    expect(r.torque_kgf_cm).toBeCloseTo(5.629165, 5);
  });

  it("share_of_rating only with a supplied rating, and says which kind", () => {
    expect(staticTorqueSingleLink(input).share_of_rating).toBeUndefined();
    const stall = staticTorqueSingleLink({ ...input, rated_stall_torque_nm: 2.0 });
    expect(stall.share_of_rating).toBeCloseTo(0.2760163, 6);
    expect(stall.rating_kind).toBe("stall");
    expect(staticTorqueSingleLink({ ...input, rated_continuous_torque_nm: 2.0 }).rating_kind).toBe("continuous");
  });
});

describe("property tests (not worked examples)", () => {
  const base = { arm_length_m: 0.25, payload_kg: 0.4, arm_kg_per_m: 0.3, angle_deg: 0 };

  it("no torque with the arm straight up (θ = 90°), exactly", () => {
    expect(staticTorqueSingleLink({ ...base, angle_deg: 90 }).torque_nm).toBe(0);
  });

  it("largest when level, and falls with cos θ", () => {
    const level = staticTorqueSingleLink(base).torque_nm;
    for (const a of [15, 30, 45, 60, 75]) expect(staticTorqueSingleLink({ ...base, angle_deg: a }).torque_nm).toBeCloseTo(level * Math.cos(radFromDeg(a)), 12);
  });

  it("linear in payload", () => {
    const t = (p: number) => staticTorqueSingleLink({ ...base, payload_kg: p }).torque_nm;
    expect(t(0.8) - t(0.4)).toBeCloseTo(t(0.4) - t(0), 12);
  });

  it("above zero with no payload: the arm's own mass always counts", () => {
    expect(staticTorqueSingleLink({ ...base, payload_kg: 0 }).torque_nm).toBeGreaterThan(0);
  });

  it("refuses to leave out the arm's own mass", () => {
    expect(() => staticTorqueSingleLink({ ...base, arm_kg_per_m: 0 })).toThrow(/own mass is always included/);
  });

  it("extra masses add their own moment", () => {
    const r = staticTorqueSingleLink({ ...base, extra_masses: [{ mass_kg: 0.1, distance_m: 0.1 }] });
    expect(r.extra_torque_nm).toBeCloseTo(STANDARD_GRAVITY_M_PER_S2 * 0.1 * 0.1, 12);
    expect(r.torque_nm).toBeCloseTo(r.payload_torque_nm + r.arm_torque_nm + r.extra_torque_nm, 12);
  });

  it("agrees with the lever solver (same physics, level arm)", () => {
    // Lever: 0.30 m, 0.05 kg; weight 0.20 kg at the far end. Same as an arm of 0.05/0.30 kg/m.
    const near = staticTorqueSingleLink({ arm_length_m: 0.3, payload_kg: 0, arm_kg_per_m: 0.05 / 0.3, angle_deg: 0, extra_masses: [{ mass_kg: 0.2, distance_m: 0.1 }] });
    const far = staticTorqueSingleLink({ arm_length_m: 0.3, payload_kg: 0.2, arm_kg_per_m: 0.05 / 0.3, angle_deg: 0 });
    const lever = relativeEffort({ lever_length_m: 0.3, lever_mass_kg: 0.05, weight_mass_kg: 0.2, weight_distance_m: 0.1 });
    expect(near.torque_nm / far.torque_nm).toBeCloseTo(lever, 12);
  });

  it("rejects bad input plainly", () => {
    expect(() => staticTorqueSingleLink({ ...base, angle_deg: 91 })).toThrow(/between 0 and 90/);
    expect(() => staticTorqueSingleLink({ ...base, angle_deg: -1 })).toThrow(/between 0 and 90/);
    expect(() => staticTorqueSingleLink({ ...base, arm_length_m: 0 })).toThrow(/arm_length_m/);
    expect(() => staticTorqueSingleLink({ ...base, payload_kg: -0.1 })).toThrow(/payload_kg/);
    expect(() => staticTorqueSingleLink({ ...base, payload_kg: Number.NaN })).toThrow(/finite/);
    expect(() => staticTorqueSingleLink({ ...base, extra_masses: [{ mass_kg: 0.1, distance_m: 0.3 }] })).toThrow(/beyond the arm/);
    expect(() => staticTorqueSingleLink({ ...base, rated_stall_torque_nm: 1, rated_continuous_torque_nm: 1 })).toThrow(/give one rating/);
    expect(() => staticTorqueSingleLink({ ...base, rated_stall_torque_nm: 0 })).toThrow(/greater than 0/);
  });
});

describe("input checks: negative, non-finite and above the sanity caps", () => {
  const ok = { arm_length_m: 0.25, payload_kg: 0.4, arm_kg_per_m: 0.3, angle_deg: 0 };
  const fields = ["arm_length_m", "payload_kg", "arm_kg_per_m", "angle_deg", "rated_stall_torque_nm", "rated_continuous_torque_nm"] as const;

  it("rejects negative, NaN and infinite values in every numeric input", () => {
    for (const f of fields)
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
        expect(() => staticTorqueSingleLink({ ...ok, [f]: bad }), `${f} = ${bad}`).toThrow(RangeError);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => staticTorqueSingleLink({ ...ok, extra_masses: [{ mass_kg: bad, distance_m: 0.1 }] }), `mass ${bad}`).toThrow(RangeError);
      expect(() => staticTorqueSingleLink({ ...ok, extra_masses: [{ mass_kg: 0.1, distance_m: bad }] }), `distance ${bad}`).toThrow(RangeError);
      expect(() => gravityMoment_nm([], 0, bad), `g ${bad}`).toThrow(RangeError);
    }
  });

  it("applies the documented sanity caps, and accepts values right at them", () => {
    const over = (o: object) => () => staticTorqueSingleLink({ ...ok, ...o });
    expect(over({ arm_length_m: SANITY_CAPS.arm_length_m + 0.01 })).toThrow(/sanity cap of 5 m/);
    expect(over({ payload_kg: SANITY_CAPS.payload_kg + 1 })).toThrow(/sanity cap of 100 kg/);
    expect(over({ arm_kg_per_m: SANITY_CAPS.arm_kg_per_m + 1 })).toThrow(/sanity cap of 50 kg\/m/);
    expect(over({ rated_stall_torque_nm: SANITY_CAPS.rated_torque_nm + 1 })).toThrow(/sanity cap of 100 N·m/);
    expect(over({ extra_masses: [{ mass_kg: SANITY_CAPS.extra_mass_kg + 1, distance_m: 0.1 }] })).toThrow(/sanity cap of 100 kg/);
    expect(() => gravityMoment_nm([], 0, 98)).toThrow(/between 9\.7 and 9\.9/); // g typed ten times too big
    expect(over({ payload_kg: SANITY_CAPS.payload_kg, rated_continuous_torque_nm: SANITY_CAPS.rated_torque_nm })).not.toThrow();
  });
});

describe("unit edges", () => {
  it("convert to SI and back", () => {
    expect(kgFromG(300)).toBe(0.3);
    expect(mFromCm(20)).toBe(0.2);
    expect(radFromDeg(180)).toBe(Math.PI);
    expect(cosDeg(0)).toBe(1);
    expect(cosDeg(90)).toBe(0);
    expect(cosDeg(60)).toBeCloseTo(0.5, 15);
    for (const t of [0.01, 0.55, 3.2]) expect(nmFromKgfCm(kgfCmFromNm(t))).toBeCloseTo(t, 12);
    expect(kgfCmFromNm(STANDARD_GRAVITY_M_PER_S2 * 0.01)).toBeCloseTo(1, 12); // 1 kgf·cm by definition
  });
});
