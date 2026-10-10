import { describe, expect, it } from "vitest";
import { placeLabels, type LabelBox } from "./labelPlacement";

const area = { w: 300, h: 200 };
const box = (id: string, x: number, y: number, priority = 0, w = 80, h = 20): LabelBox => ({ id, x, y, w, h, priority });
const rect = (p: { x: number; y: number }, l: LabelBox) => ({ x: p.x, y: p.y, w: l.w, h: l.h });
const touch = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("label collision avoidance", () => {
  it("leaves labels that don't collide where they are", () => {
    const ls = [box("a", 10, 10), box("b", 150, 100)];
    expect(placeLabels(ls, area)).toEqual([
      { id: "a", x: 10, y: 10, hidden: false },
      { id: "b", x: 150, y: 100, hidden: false },
    ]);
  });

  it("the selected label keeps its spot; the other moves to the nearest free spot", () => {
    const hand = box("hand", 20, 80);
    const selected = box("weight", 40, 85, 10, 140); // "Selected: Weight", wider, on top of the hand label
    const [h, s] = placeLabels([hand, selected], area);
    expect(s).toEqual({ id: "weight", x: 40, y: 85, hidden: false });
    expect(h!.hidden).toBe(false);
    expect(touch(rect(h!, hand), rect(s!, selected))).toBe(false);
    expect(h!.y).toBeLessThan(85); // moved just above, the nearest free spot
  });

  it("stays inside the area; hides a label only when there is no free spot", () => {
    const tiny = { w: 100, h: 30 };
    const [a, b] = placeLabels([box("a", 6, 6, 1, 88, 18), box("b", 6, 6, 0, 88, 18)], tiny);
    expect(a!.hidden).toBe(false);
    expect(b!.hidden).toBe(true);
  });

  it("never returns two visible labels that overlap", () => {
    const ls = Array.from({ length: 6 }, (_, i) => box(`l${i}`, 60 + i * 5, 90 + i * 3, i === 2 ? 10 : 0));
    const out = placeLabels(ls, area);
    const vis = out.filter((p) => !p.hidden);
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) expect(touch(rect(vis[i]!, ls[0]!), rect(vis[j]!, ls[0]!))).toBe(false);
    expect(out.find((p) => p.id === "l2")).toMatchObject({ x: 70, y: 96, hidden: false });
  });
});
