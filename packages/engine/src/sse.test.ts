import { describe, expect, it } from "vitest";
import { createFakeDirector, createSseParser, encodeComment, encodeEvent, TurnSession, type TurnEvent } from "./index";
import { fixtureRegistry } from "./__fixtures__/registry";

const events = async () => {
  const out: TurnEvent[] = [];
  const s = new TurnSession({
    registry: fixtureRegistry().registry,
    director: createFakeDirector("valid"),
    state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" },
    concepts: ["mech.torque.static"],
    level: "L2",
  });
  await s.run({ text: "hi", reply: { answered_prompt: false } }, (e) => out.push(e));
  return out;
};
const parse = (chunks: string[]) => {
  const got: TurnEvent[] = [];
  const problems: string[] = [];
  const p = createSseParser((e) => got.push(e), (x) => problems.push(x));
  for (const c of chunks) p.push(c);
  return { got, problems, leftover: p.leftover() };
};

describe("SSE framing", () => {
  it("round-trips a whole turn, in order", async () => {
    const evs = await events();
    expect(parse([evs.map(encodeEvent).join("")]).got).toEqual(evs);
  });

  it("copes with events split anywhere across chunks, even one character at a time", async () => {
    const wire = (await events()).map(encodeEvent).join("");
    const r = parse([...wire]);
    expect(r.got.map((e) => e.type)).toEqual(["turn.started", "narration", "narration", "action", "action", "calc.result", "prompt", "turn.done"]);
    expect(r.leftover).toBe("");
  });

  it("accepts CRLF line ends, including a CRLF split between chunks, and ignores comments", async () => {
    const [e] = await events();
    const crlf = encodeEvent(e!).replace(/\n/g, "\r\n");
    const r = parse([encodeComment("keep-alive"), crlf.slice(0, crlf.indexOf("\r") + 1), crlf.slice(crlf.indexOf("\r") + 1)]);
    expect(r.got).toEqual([e]);
    expect(r.problems).toEqual([]);
  });

  it("reports bad frames instead of throwing, and keeps an incomplete frame as leftover", () => {
    const r = parse(["data: {not json}\n\n", 'data: {"type":"narration"}\n\n', 'data: {"type":"turn.done","turn_id":"t","seq":0,"rev":1']);
    expect(r.got).toEqual([]);
    expect(r.problems).toEqual(["an event's data was not valid JSON", "an event was missing type, turn_id, seq or rev"]);
    expect(r.leftover).toMatch(/^data: /); // the stream ended mid-frame: the client treats it as a dropped connection
  });
});
