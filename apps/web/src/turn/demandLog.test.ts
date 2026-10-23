import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demandLogDeps, demandMode, handleDemand } from "./demandLog";

// The local demand log (step 4 session 2): dev only, local requests only, the topic and place only.

const post = (body: unknown, host = "127.0.0.1:3000") =>
  new Request(`http://${host}/api/demand`, { method: "POST", headers: { host, "content-type": "application/json" }, body: JSON.stringify(body) });
const ASK = { topic: "learned-controllers", from: "drone-pid lesson" };

describe("the demand log", () => {
  const dir = demandLogDeps.dir;
  afterEach(() => {
    demandLogDeps.dir = dir;
  });

  it("modes: written on a dev server, answered without writing in a testing build, off in production", () => {
    expect(demandMode({ NODE_ENV: "development" })).toBe("write");
    expect(demandMode({ NODE_ENV: "production", NEXT_PUBLIC_AILI_FAKE_DIRECTOR: "1" })).toBe("test");
    expect(demandMode({ NODE_ENV: "production" })).toBe("off");
  });

  it("on a dev server: one line with the time, the topic and where it was asked; nothing about the learner", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "aili-demand-"));
    demandLogDeps.dir = () => tmp;
    const res = await handleDemand(post(ASK), { NODE_ENV: "development" });
    expect(await res.json()).toEqual({ ok: true, written: true });
    const text = readFileSync(join(tmp, "demand.md"), "utf8");
    expect(text).toMatch(/^- \d{4}-\d{2}-\d{2}T.* · learned-controllers · asked from the drone-pid lesson\n$/);
  });

  it("a testing build writes nothing; production and other hosts get 404; unknown topics are refused", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "aili-demand-"));
    demandLogDeps.dir = () => tmp;
    expect(await (await handleDemand(post(ASK), { NODE_ENV: "production", NEXT_PUBLIC_AILI_FAKE_DIRECTOR: "1" })).json()).toEqual({ ok: true, written: false });
    expect(existsSync(join(tmp, "demand.md"))).toBe(false);
    expect((await handleDemand(post(ASK), { NODE_ENV: "production" })).status).toBe(404);
    expect((await handleDemand(post(ASK, "192.168.100.7:3000"), { NODE_ENV: "development" })).status).toBe(404);
    expect((await handleDemand(post({ topic: "anything", from: "drone-pid lesson" }), { NODE_ENV: "development" })).status).toBe(400);
  });
});
