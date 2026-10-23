import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConfig, type RuntimeModel } from "@aili/schemas";
import {
  createFakeRouter,
  directorResponseJsonSchema,
  InMemoryLedger,
  keyPresent,
  professorPrompt,
  ProviderDirector,
  ProviderError,
  TurnSession,
  type SessionState,
  type TurnEvent,
} from "../index";
import { fixtureRegistry } from "../__fixtures__/registry";
import valid from "../__recordings__/valid-explain.hand-written.json";
import { ANTHROPIC_VERSION, AnthropicProvider, createProfessorProvider, fromAnthropicShape, scrubProviderMessage, toAnthropicSchema, type AnthropicDiagnostic } from "./index";
import { errors, message, refusal, SECRET_BODY_TEXT, type MockReply } from "./__fixtures__/anthropicResponses";
import { mockServer } from "./__fixtures__/mockServer";

// The Anthropic adapter against a LOCAL mock HTTP server on 127.0.0.1 (docs/m3-plan.md slice 6).
// No real key, no external network. Responses are hand-written fixtures derived from the docs.

const ROOT = new URL("../../../../", import.meta.url);
const TEMPLATE = readFileSync(new URL("content/prompts/professor.v1.md", ROOT), "utf8");
const PLANTED = "planted-FAKE-key-0123456789abcdef";

function config(o: { thinking?: "adaptive"; effort?: "medium"; provider?: string } = {}) {
  const c = JSON.parse(readFileSync(new URL("config/ai.json", ROOT), "utf8"));
  for (const m of ["professor", "router"] as const) {
    c.models[m].provider = o.provider ?? "anthropic";
    c.models[m].model = "fixture-model";
    delete c.models[m].thinking; // each test sets these itself
    delete c.models[m].effort;
    if (o.thinking) c.models[m].thinking = o.thinking;
    if (o.effort) c.models[m].effort = o.effort;
  }
  c.provider_monthly_limit_set = { by: "test", on: "2026-10-12", usd: 5 };
  return AiConfig.parse(c);
}
const envWithKey = (c: AiConfig) => ({ [c.models.professor.api_key_env]: PLANTED, [c.models.router.api_key_env]: PLANTED });

/** The valid recorded answer as the model would send it: calc inputs as { name, value } pairs. */
const VALID = (valid.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
const WIRE = {
  ...VALID,
  calc_requests: (VALID.calc_requests as Array<{ inputs: Record<string, unknown> }>).map((r) => ({ ...r, inputs: Object.entries(r.inputs).map(([name, value]) => ({ name, value })) })),
};
const ok = () => message(JSON.stringify(WIRE));

afterEach(() => vi.restoreAllMocks());

const start = (): SessionState => ({ history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" });

/** One live turn: fake router, the provider-backed director, the Anthropic adapter on the mock server. */
async function liveTurn(replies: MockReply[], c = config()) {
  const srv = await mockServer(replies);
  const env = envWithKey(c);
  const hasKey = (m: RuntimeModel) => keyPresent(c, m, env);
  const provider = createProfessorProvider(c, "professor", () => env, { baseUrl: srv.url });
  const director = new ProviderDirector({ provider, config: c, hasKey: () => hasKey("professor"), prompt: professorPrompt(TEMPLATE), outputSchema: directorResponseJsonSchema(), sleep: async () => {} });
  const ledger = new InMemoryLedger();
  const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state: start(), concepts: ["mech.torque.static"], level: "L2", meter: { ledger, sessionId: "p", config: c, killSwitch: false, live: { hasKey } } });
  const events: TurnEvent[] = [];
  return { srv, s, ledger, events, run: () => s.run({ text: "Why is it hard to hold?" }, (e) => events.push(e)) };
}
const last = (events: TurnEvent[]) => events.at(-1)!;
const errorOf = (events: TurnEvent[]) => last(events) as Extract<TurnEvent, { type: "turn.error" }>;
const professorAttempts = (ledger: InMemoryLedger) => ledger.entries("p").filter((e) => e.model === "professor");

function simpleRequest(signal = new AbortController().signal) {
  return { system: "sys", input: "in", outputSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] }, maxOutputTokens: 1200, signal };
}

describe("structured-output schema for Anthropic", () => {
  const DROPPED = ["$schema", "pattern", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "maxItems", "uniqueItems", "propertyNames", "oneOf"];
  const { schema, mapPaths } = toAnthropicSchema(directorResponseJsonSchema());

  it("keeps none of the keywords the docs list as unsupported, and closes every object", () => {
    const walk = (node: unknown, where: string) => {
      if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${where}[${i}]`));
      if (!node || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      for (const k of DROPPED) expect(k in o, `${where}.${k}`).toBe(false);
      if (typeof o.minItems === "number") expect(o.minItems, `${where}.minItems`).toBeLessThanOrEqual(1);
      if (o.type === "object") expect(o.additionalProperties, `${where}.additionalProperties`).toBe(false);
      for (const [k, v] of Object.entries(o)) if (k !== "properties") walk(v, `${where}.${k}`);
      if (o.properties) for (const [k, v] of Object.entries(o.properties as object)) walk(v, `${where}.properties.${k}`);
    };
    walk(schema, "$");
  });

  it("flattens the actions union into one shape: type from the list, every other field optional (accepted by the provider, 2026-10-12; nested in narration since 2026-10-14)", () => {
    const items = (schema as { properties: { narration: { items: { properties: { actions: { items: { anyOf?: unknown; properties: Record<string, { enum?: string[] }>; required: string[] } } } } } } }).properties.narration.items.properties.actions.items;
    expect(items.anyOf).toBeUndefined();
    expect(items.properties.type!.enum).toEqual(["select_scene", "highlight_part", "set_parameter", "play_animation", "show_choices", "apply_preset", "run_simulation"]);
    expect(items.required).toEqual(["type"]);
    expect(Object.keys(items.properties).sort()).toEqual(["animation", "by", "choices", "param", "part", "preset", "scene", "start", "type", "value"]);
  });

  it("sends calc inputs as { name, value } pairs and turns them back into the map", () => {
    expect(mapPaths).toEqual([["calc_requests", "*", "inputs"]]);
    expect(fromAnthropicShape(WIRE, mapPaths)).toEqual(VALID);
    expect(fromAnthropicShape({ move: "explain" }, mapPaths)).toEqual({ move: "explain" }); // no calc_requests: unchanged
  });
});

describe("requests", () => {
  it("sends the documented headers, the model from config and the structured-output format", async () => {
    const srv = await mockServer([message('{"a":"x"}', { input: 100, output: 20, cacheRead: 30, cacheWrite: 5 })]);
    const c = config();
    const p = new AnthropicProvider({ config: c, model: "professor", env: () => envWithKey(c), baseUrl: srv.url });
    const r = await p.complete(simpleRequest());
    expect(r.json).toEqual({ a: "x" });
    expect(r.usage).toEqual({ model: "professor", input_tokens: 135, output_tokens: 20 }); // cache reads and writes count as input
    const [req] = srv.received;
    expect(req!.headers["x-api-key"]).toBe(PLANTED);
    expect(req!.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(req!.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(req!.body);
    expect(body).toMatchObject({ model: "fixture-model", max_tokens: 1200, system: "sys", messages: [{ role: "user", content: "in" }] });
    expect(body.output_config.format).toEqual({ type: "json_schema", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } });
    expect(body.thinking).toBeUndefined();
    expect(body.output_config.effort).toBeUndefined();
  });

  it("passes thinking and effort only when config sets them", async () => {
    const srv = await mockServer([message('{"a":"x"}', { thinking: true })]);
    const c = config({ thinking: "adaptive", effort: "medium" });
    const r = await new AnthropicProvider({ config: c, model: "professor", env: () => envWithKey(c), baseUrl: srv.url }).complete(simpleRequest());
    expect(r.json).toEqual({ a: "x" }); // the thinking block is skipped
    const body = JSON.parse(srv.received[0]!.body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config.effort).toBe("medium");
  });

  it("reads the key at call time; with no key or no model it sends nothing (not_configured)", async () => {
    const srv = await mockServer([ok()]);
    const c = config();
    let env: Record<string, string> = {};
    const p = new AnthropicProvider({ config: c, model: "professor", env: () => env, baseUrl: srv.url });
    await expect(p.complete(simpleRequest())).rejects.toMatchObject({ kind: "not_configured" });
    env = envWithKey(c);
    await expect(p.complete(simpleRequest())).resolves.toBeDefined();
    const noModel = AiConfig.parse({ ...c, models: { ...c.models, professor: { ...c.models.professor, model: null } } });
    await expect(new AnthropicProvider({ config: noModel, model: "professor", env: () => env, baseUrl: srv.url }).complete(simpleRequest())).rejects.toMatchObject({ kind: "not_configured" });
    expect(srv.received).toHaveLength(1);
  });

  it("refuses a plain-http address that is not this computer, so the key is never sent in clear", () => {
    const c = config();
    expect(() => new AnthropicProvider({ config: c, model: "professor", env: () => ({}), baseUrl: "http://example.com" })).toThrow(/https/);
  });

  it("an unknown provider in config gives an adapter that answers not_configured", async () => {
    await expect(createProfessorProvider(config({ provider: "someone-else" }), "professor", () => ({})).complete(simpleRequest())).rejects.toMatchObject({ kind: "not_configured" });
  });

  it("missing usage is undefined, so the attempt is metered conservatively", async () => {
    const body = { ...(ok().body as object), usage: undefined };
    const srv = await mockServer([{ status: 200, body }]);
    const c = config();
    const r = await new AnthropicProvider({ config: c, model: "professor", env: () => envWithKey(c), baseUrl: srv.url }).complete(simpleRequest());
    expect(r.usage).toBeUndefined();
  });

  it("a connection refused before sending is 'unreachable'", async () => {
    const srv = await mockServer([ok()]);
    await srv.close();
    const c = config();
    await expect(new AnthropicProvider({ config: c, model: "professor", env: () => envWithKey(c), baseUrl: srv.url }).complete(simpleRequest())).rejects.toMatchObject({ kind: "unreachable" });
  });
});

describe("whole turns through the adapter", () => {
  it("success: the structured answer becomes a completed turn, metered with the reported tokens", async () => {
    const t = await liveTurn([ok()]);
    await t.run();
    expect(last(t.events).type).toBe("turn.done");
    expect(t.srv.received).toHaveLength(1);
    expect(professorAttempts(t.ledger).map((e) => [e.input_tokens, e.output_tokens])).toEqual([[4200, 380]]);
  });

  it("a truncated answer (stop_reason max_tokens) is rejected and repaired once", async () => {
    const t = await liveTurn([message(JSON.stringify(WIRE).slice(0, 150), { stop_reason: "max_tokens", output: 1200 }), ok()]);
    await t.run();
    expect(last(t.events).type).toBe("turn.done");
    expect(t.srv.received).toHaveLength(2);
    expect(JSON.parse(t.srv.received[1]!.body).messages[0].content).toContain("failed these checks. Keep its content and change only what these errors name");
    expect(professorAttempts(t.ledger)).toHaveLength(2);
  });

  it("invalid JSON twice ends as a validation failure, keeping the last valid state", async () => {
    const t = await liveTurn([message("not json at all")]);
    await t.run();
    expect(errorOf(t.events).reason).toBe("validation");
    expect(t.srv.received).toHaveLength(2);
  });

  it("with no patterns in the schema sent, our validator still rejects a badly formed ID (after the one repair)", async () => {
    const bad = message(JSON.stringify({ ...WIRE, concepts: ["Not A Concept ID"] }));
    const t = await liveTurn([bad, bad]);
    await t.run();
    const sent = JSON.stringify(JSON.parse(t.srv.received[0]!.body).output_config.format.schema);
    expect(sent).not.toContain('"pattern"');
    const e = errorOf(t.events);
    expect(e.reason).toBe("validation");
    expect(e.details.join("\n")).toMatch(/concepts/);
    expect(t.srv.received).toHaveLength(2); // the answer and its repair, both rejected
  });

  const rows: Array<[string, string, number, MockReply[]]> = [
    ["401", "key_rejected", 1, [errors.unauthorized()]],
    ["403", "key_rejected", 1, [errors.forbidden()]],
    ["400, own monthly limit", "spend_limit", 1, [errors.ownSpendLimit()]],
    ["400, own workspace limit", "spend_limit", 1, [errors.ownWorkspaceSpendLimit()]],
    ["429, tier spend cap", "spend_limit", 1, [errors.tierSpendCap()]],
    ["other 400", "director", 1, [errors.invalidRequest()]],
    ["402", "director", 1, [errors.billing()]],
    ["404", "director", 1, [errors.notFound()]],
    ["413", "director", 1, [errors.tooLarge()]],
    ["500 twice", "director", 2, [errors.server(), errors.server()]],
    ["429 twice", "director", 2, [errors.rateLimited(), errors.rateLimited()]],
    ["refusal", "refused", 1, [refusal()]],
  ];
  it.each(rows)("%s → %s after %i request(s), with no body text in the event", async (_, reason, requests, replies) => {
    const t = await liveTurn(replies);
    await t.run();
    const e = errorOf(t.events);
    expect(e.reason).toBe(reason);
    expect(t.srv.received).toHaveLength(requests);
    expect(JSON.stringify(t.events)).not.toContain(SECRET_BODY_TEXT);
    expect(e.details.join(" ")).not.toMatch(/error\b.*message/);
  });

  it("the spend-limit message is plain, and a spend limit is metered at zero", async () => {
    const t = await liveTurn([errors.tierSpendCap()]);
    await t.run();
    expect(errorOf(t.events).message).toBe("The monthly spending limit for live answers has been reached. Prepared lessons still work. Nothing on the stage changed.");
    expect(professorAttempts(t.ledger).every((e) => e.cost_micro_usd === 0)).toBe(true);
  });

  it("a refusal is metered with the tokens the provider reported", async () => {
    const t = await liveTurn([refusal()]);
    await t.run();
    expect(professorAttempts(t.ledger).map((e) => [e.input_tokens, e.output_tokens])).toEqual([[4200, 12]]);
  });

  it.each([
    ["other 429", errors.rateLimited()],
    ["500", errors.server()],
    ["529 overloaded", errors.overloaded()],
  ])("%s is retried once, then succeeds", async (_, first) => {
    const t = await liveTurn([first, ok()]);
    await t.run();
    expect(last(t.events).type).toBe("turn.done");
    expect(t.srv.received).toHaveLength(2);
  });

  it("an interrupt aborts the request in flight: the connection closes, nothing is retried", async () => {
    const t = await liveTurn(["hang"]);
    const running = t.run();
    await vi.waitFor(() => expect(t.srv.received).toHaveLength(1));
    t.s.interrupt();
    await running;
    await vi.waitFor(() => expect(t.srv.closedEarly()).toBe(1));
    expect(t.srv.received).toHaveLength(1);
    expect(t.events.some((e) => e.type === "turn.done")).toBe(false);
    // aborted after sending: metered conservatively
    const [a] = professorAttempts(t.ledger);
    expect(a!.output_tokens).toBe(config().models.professor.max_output_tokens);
  });
});

describe("a planted key never leaks", () => {
  it("the key appears only in the x-api-key header: no body, event, ledger entry, error or log line", async () => {
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const scripts: MockReply[][] = [[ok()], [errors.unauthorized()], [errors.ownSpendLimit()], [errors.server(), errors.overloaded()], [message("{trunc")], [refusal()], [errors.invalidRequest()]];
    const seen: unknown[] = [];
    for (const replies of scripts) {
      const t = await liveTurn(replies);
      await t.run();
      for (const r of t.srv.received) {
        expect(r.headers["x-api-key"]).toBe(PLANTED); // sent where it belongs
        const { "x-api-key": _key, ...otherHeaders } = r.headers;
        seen.push(r.body, otherHeaders);
      }
      seen.push(t.events, t.ledger.entries("p"));
    }
    const c = config();
    const p = new AnthropicProvider({ config: c, model: "professor", env: () => envWithKey(c), baseUrl: (await mockServer([errors.unauthorized()])).url });
    const err = await p.complete(simpleRequest()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    seen.push(String(err), (err as Error).stack, JSON.stringify(err), p);
    const all = JSON.stringify(seen) + logs.join("\n");
    expect(all.length).toBeGreaterThan(1000);
    expect(all).not.toContain(PLANTED);
    expect(all).not.toContain(PLANTED.slice(0, 12));
    expect(all).not.toContain(SECRET_BODY_TEXT);
  });
});

describe("live diagnostics (terminal only)", () => {
  it("scrubs the key itself, anything key-like, and cuts at 300 characters", () => {
    const m = scrubProviderMessage(`bad key ${PLANTED} or sk-ant-api03-abcDEF_123-xyz and ${"A".repeat(40)} ` + "x".repeat(400), PLANTED);
    expect(m).not.toContain(PLANTED);
    expect(m).not.toContain("sk-ant-");
    expect(m).not.toContain("A".repeat(32));
    expect(m.length).toBeLessThanOrEqual(301);
    expect(m).toContain("[redacted]");
  });

  it("reports the provider's error type and scrubbed message to the hook only; the thrown error carries a kind and status", async () => {
    const srv = await mockServer([{ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: `schema rejected; key was ${PLANTED}` } } }]);
    const c = config();
    const seen: AnthropicDiagnostic[] = [];
    const p = new AnthropicProvider({ config: c, model: "professor", env: () => envWithKey(c), baseUrl: srv.url, onDiagnostic: (d) => seen.push(d) });
    const err = await p.complete(simpleRequest()).catch((e: unknown) => e);
    expect(seen).toEqual([{ type: "error", model: "professor", status: 400, error_type: "invalid_request_error", message: "schema rejected; key was [redacted]" }]);
    expect(String(err)).toBe("ProviderError: provider: bad_request (HTTP 400)");
  });

  it("reports a response's stop reason and tokens, thinking tokens included when the provider reports them", async () => {
    const r = message('{"a":"x"}', { input: 100, output: 50 });
    (r.body.usage as Record<string, unknown>).output_tokens_details = { thinking_tokens: 30 };
    const srv = await mockServer([r]);
    const c = config();
    const seen: AnthropicDiagnostic[] = [];
    await new AnthropicProvider({ config: c, model: "router", env: () => envWithKey(c), baseUrl: srv.url, onDiagnostic: (d) => seen.push(d) }).complete(simpleRequest());
    expect(seen[0]).toMatchObject({ type: "response", model: "router", stop_reason: "end_turn", input_tokens: 100, output_tokens: 50, thinking_tokens: 30 });
  });

  it("a hook that throws never breaks the call", async () => {
    const srv = await mockServer([message('{"a":"x"}')]);
    const c = config();
    const p = new AnthropicProvider({ config: c, model: "router", env: () => envWithKey(c), baseUrl: srv.url, onDiagnostic: () => { throw new Error("boom"); } });
    await expect(p.complete(simpleRequest())).resolves.toMatchObject({ json: { a: "x" } });
  });
});
