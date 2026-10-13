import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProfessorProvider, directorResponseJsonSchema, ProviderDirector, ProviderRouter, professorPrompt, keyPresent, type AnthropicDiagnostic, type ProfessorProvider } from "@aili/engine";
import type { AiConfig, RuntimeModel } from "@aili/schemas";

// Live turns in the browser, LAPTOP ONLY (docs/m3-live-browser-plan.md slice 1). Server-only: no
// NEXT_PUBLIC_ variable is involved, so nothing about live mode is inlined into the client bundle.
// The key is read by the provider adapter at call time; this file only checks that it is present.

type Env = Record<string, string | undefined>;

/**
 * Live mode is on only with AILI_LIVE=1 (set by `npm run dev:live`) and never in a production
 * server (`next start` runs with NODE_ENV=production; a production build also has no fixtures).
 */
export const liveEnabled = (env: Env = process.env): boolean => env.AILI_LIVE === "1" && env.NODE_ENV !== "production";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Local requests only, so a phone on the Wi-Fi cannot spend the laptop's key. `dev:live` also binds
 * the server to 127.0.0.1; this Host check is the second barrier. AILI_LIVE_ALLOW_LAN=1 (server-only)
 * lifts it, for Lucky to set by hand if ever wanted.
 */
export function isLocalRequest(request: Request, env: Env = process.env): boolean {
  if (env.AILI_LIVE_ALLOW_LAN === "1") return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return LOCAL_HOSTS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/**
 * Free text has no planner yet (M4), so a live turn shortlists every concept the test fixtures
 * teach, at L2 (Lucky's decision 2026-10-13). A stand-in, not the planner; anything outside these
 * gets the honest "not supported yet" path.
 */
export const LIVE_CONCEPTS = ["mech.torque.static", "mech.moment-arm"];
export const LIVE_LEVEL = "L2";

let templates: { professor: string; router: string } | null = null;
/** The prompt templates, read once from content/prompts (the dev server runs in apps/web). */
function loadTemplates() {
  const dir = join(process.cwd(), "..", "..", "content", "prompts");
  templates ??= { professor: readFileSync(join(dir, "professor.v1.md"), "utf8"), router: readFileSync(join(dir, "router.v1.md"), "utf8") };
  return templates;
}

// Provider diagnostics go to the dev server's terminal only, already scrubbed by the adapter (no key,
// no header, no body). Token counts let Lucky see each call's size.
const diagnostic = (d: AnthropicDiagnostic) =>
  console.error(
    d.type === "error"
      ? `[live] provider ${d.model}: HTTP ${d.status} ${d.error_type}: ${d.message}`
      : `[live] provider ${d.model}: HTTP ${d.status} stop_reason=${d.stop_reason} input=${d.input_tokens} output=${d.output_tokens}`,
  );

/** Replaceable in unit tests (a recorded provider, no network); the real adapter otherwise. */
export const liveDeps = {
  provider: (config: AiConfig, model: RuntimeModel): ProfessorProvider => createProfessorProvider(config, model, () => process.env, { onDiagnostic: diagnostic }),
};

/** The provider-backed director and router, as the bake-off builds them, and the live key checks. */
export function liveTurnParts(config: AiConfig) {
  const t = loadTemplates();
  const hasKey = (m: RuntimeModel) => keyPresent(config, m, process.env);
  return {
    director: new ProviderDirector({ provider: liveDeps.provider(config, "professor"), config, hasKey: () => hasKey("professor"), prompt: professorPrompt(t.professor), outputSchema: directorResponseJsonSchema() }),
    router: new ProviderRouter({ provider: liveDeps.provider(config, "router"), config, hasKey: () => hasKey("router"), template: t.router }),
    live: { hasKey },
  };
}

/** A short, key-free summary of what the model sent, for the dev terminal: move, prompt kind, narration lengths. */
export function summarizeAttempt(raw: unknown): string {
  const r = (raw ?? {}) as { move?: unknown; prompt?: { kind?: unknown } | null; narration?: Array<{ text?: unknown }>; actions?: Array<{ type?: unknown }>; calc_requests?: unknown[] };
  const lengths = Array.isArray(r.narration) ? r.narration.map((n) => (typeof n?.text === "string" ? n.text.length : "?")).join("+") : "none";
  const actions = Array.isArray(r.actions) ? r.actions.map((a) => String(a?.type)).join(",") || "none" : "none";
  return `move=${String(r.move)} prompt=${r.prompt ? String(r.prompt.kind ?? "question") : "none"} narration=${lengths} chars actions=${actions} calcs=${Array.isArray(r.calc_requests) ? r.calc_requests.length : 0}`;
}

type CheckLog = { attempt: 1 | 2; outcome: string; errors: string[]; warnings: string[]; raw?: unknown };
/**
 * Live mode only: each attempt's outcome, rule messages and a summary of what the model sent, to the
 * dev server's terminal. Never the learner's text, a key or a header.
 */
export const logCheck = (sessionId: string, rev: number) => (c: CheckLog) => {
  console.error(`[live] session ${sessionId.slice(0, 8)} turn ${rev} attempt ${c.attempt}: ${c.outcome} · ${summarizeAttempt(c.raw)}`);
  for (const e of c.errors) console.error(`[live]   rejected: ${e}`);
  for (const w of c.warnings) console.error(`[live]   warning: ${w}`);
};
