import { describe, expect, it } from "vitest";
import { initialVoiceState, voiceReducer, type VoiceEvent, type VoiceState } from "./machine";

const run = (events: VoiceEvent[], from: VoiceState = initialVoiceState) => events.reduce(voiceReducer, from);

describe("voice state machine", () => {
  it("goes idle → thinking → speaking → idle for one prepared reply", () => {
    let s = run([{ type: "submit" }]);
    expect(s.status).toBe("thinking");
    const rev = s.rev;
    s = run([{ type: "speak", rev, seq: 0, text: "one" }], s);
    expect(s.status).toBe("speaking");
    expect(s.caption?.text).toBe("one");
    s = run([{ type: "speak", rev, seq: 1, text: "two" }, { type: "done", rev }], s);
    expect(s.status).toBe("idle");
    expect(s.caption?.text).toBe("two");
  });

  it("listening ends back in idle, and an error is shown until reset", () => {
    let s = run([{ type: "listen" }]);
    expect(s.status).toBe("listening");
    s = run([{ type: "listenEnd", rev: s.rev }], s);
    expect(s.status).toBe("idle");
    s = run([{ type: "listen" }], s);
    s = run([{ type: "error", rev: s.rev, message: "Microphone permission was refused." }], s);
    expect(s).toMatchObject({ status: "error", error: "Microphone permission was refused." });
    expect(run([{ type: "reset" }], s)).toMatchObject({ status: "idle", error: null });
  });

  it("drops a stale action that arrives after an interrupt", () => {
    let s = run([{ type: "submit" }]);
    const oldRev = s.rev;
    s = run([{ type: "speak", rev: oldRev, seq: 0, text: "first segment" }], s);
    s = run([{ type: "interrupt" }], s);
    expect(s).toMatchObject({ status: "idle", caption: null, note: "Stopped" });

    // The timer for segment 2 fires late, after the interrupt.
    const after = run([{ type: "speak", rev: oldRev, seq: 1, text: "second segment" }], s);
    expect(after).toBe(s); // unchanged: the stale action was ignored
    expect(run([{ type: "done", rev: oldRev }], s)).toBe(s);
    expect(run([{ type: "error", rev: oldRev, message: "late" }], s)).toBe(s);
  });

  it("a new input makes the previous reply's queued segments stale (barge-in)", () => {
    let s = run([{ type: "submit" }]);
    const first = s.rev;
    s = run([{ type: "speak", rev: first, seq: 0, text: "old reply" }, { type: "submit" }], s);
    expect(s.status).toBe("thinking");
    const dropped = run([{ type: "speak", rev: first, seq: 1, text: "old reply, part 2" }], s);
    expect(dropped).toBe(s);
    s = run([{ type: "speak", rev: s.rev, seq: 0, text: "new reply" }], s);
    expect(s.caption?.text).toBe("new reply");
  });

  it("drops repeated or out-of-order caption segments", () => {
    let s = run([{ type: "submit" }]);
    const rev = s.rev;
    s = run([{ type: "speak", rev, seq: 0, text: "a" }, { type: "speak", rev, seq: 1, text: "b" }], s);
    expect(run([{ type: "speak", rev, seq: 1, text: "b again" }], s)).toBe(s);
    expect(run([{ type: "speak", rev, seq: 0, text: "a late" }], s)).toBe(s);
  });

  it("starting to listen also invalidates anything still queued", () => {
    let s = run([{ type: "submit" }]);
    const rev = s.rev;
    s = run([{ type: "listen" }], s);
    expect(run([{ type: "speak", rev, seq: 0, text: "late" }], s)).toBe(s);
  });

  it("an interrupt while idle changes nothing visible but still bumps the revision", () => {
    const s = run([{ type: "interrupt" }]);
    expect(s).toMatchObject({ status: "idle", caption: null, note: null, rev: 1 });
  });

  it("demo control can show every state", () => {
    for (const status of ["idle", "listening", "thinking", "speaking", "error"] as const) {
      expect(run([{ type: "demoSet", status }]).status).toBe(status);
    }
  });
});
