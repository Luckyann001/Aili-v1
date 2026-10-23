// Label collision avoidance (M1 slice 5). Labels are placed in priority order: the selected part
// first (it never moves), then the rest. A label that would overlap one already placed tries the
// nearest free spot just above, below, left or right of it, inside the safe area; if none is
// free, it is hidden rather than drawn on top of another label. A label may also name a box it must
// never cover: the screen box of the part it names (16 Oct 2026), so it sits beside its part, not on it.

export interface LabelBox {
  id: string;
  /** Wanted top-left, already clamped inside the area. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher goes first. The selected part's label has the highest priority. */
  priority: number;
  /** The part this label names, on screen: the label never covers it. */
  avoid?: { x: number; y: number; w: number; h: number };
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  hidden: boolean;
}

const GAP = 4;

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

export function placeLabels(labels: LabelBox[], area: { w: number; h: number }, pad = 6): Placed[] {
  const inside = (r: { x: number; y: number; w: number; h: number }) =>
    r.x >= pad - 0.5 && r.y >= pad - 0.5 && r.x + r.w <= area.w - pad + 0.5 && r.y + r.h <= area.h - pad + 0.5;
  const placed: Array<LabelBox & { hidden: boolean }> = [];
  const order = [...labels].sort((a, b) => b.priority - a.priority);

  for (const l of order) {
    const free = (r: LabelBox) => (!r.avoid || !overlaps(r, r.avoid)) && placed.every((p) => p.hidden || !overlaps(r, p));
    if (free(l)) {
      placed.push({ ...l, hidden: false });
      continue;
    }
    // Candidate spots around every label in the way (and beside or below its own part), nearest to the wanted spot first.
    const candidates: LabelBox[] = [];
    if (l.avoid) {
      const a = l.avoid;
      candidates.push({ ...l, y: a.y - l.h - GAP - 2 }, { ...l, y: a.y + a.h + GAP + 2 }, { ...l, x: a.x - l.w - GAP - 2 }, { ...l, x: a.x + a.w + GAP + 2 });
    }
    for (const p of placed) {
      if (p.hidden || !overlaps(l, p)) continue;
      candidates.push(
        { ...l, y: p.y - l.h - GAP },
        { ...l, y: p.y + p.h + GAP },
        { ...l, x: p.x - l.w - GAP },
        { ...l, x: p.x + p.w + GAP },
      );
    }
    candidates.sort((a, b) => Math.hypot(a.x - l.x, a.y - l.y) - Math.hypot(b.x - l.x, b.y - l.y));
    const spot = candidates.find((c) => inside(c) && free(c));
    // The first label (the selected or pointed-at part's) is never hidden, even with nowhere better to go.
    placed.push(spot ? { ...spot, hidden: false } : placed.length === 0 ? { ...l, hidden: false } : { ...l, hidden: true });
  }
  return labels.map((l) => {
    const p = placed.find((q) => q.id === l.id)!;
    return { id: l.id, x: p.x, y: p.y, hidden: p.hidden };
  });
}
