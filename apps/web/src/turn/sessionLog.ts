import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TurnEvent } from "@aili/engine";

// The local session log for live turns (docs/m3-live-browser-plan.md slice 5). LAPTOP ONLY, Lucky's
// own sessions: one readable Markdown file per page session in the git-ignored folder
// `live-sessions/` at the repo root. Never uploaded, never shared; `npm run live-sessions:delete`
// deletes them all. What is written: the learner's text, the answer as shown, the router's reading,
// each attempt's outcome and rejection reasons, warnings, cost and latency. Never a key or header.

export interface LoggedAttempt {
  attempt: 1 | 2;
  outcome: string;
  summary: string;
  errors: string[];
  warnings: string[];
}

export interface TurnRecord {
  rev: number;
  startedAt: Date;
  latencyMs: number;
  learnerText: string;
  router: Record<string, unknown> | null;
  attempts: LoggedAttempt[];
  events: TurnEvent[];
  costMicroUsd: number;
  sessionCostMicroUsd: number;
}

/** Where the logs go; replaceable in tests. */
export const sessionLogDeps = { dir: () => join(process.cwd(), "..", "..", "live-sessions") };

const files = new Map<string, string>();

/** The answer as the learner saw it, or the plain failure line. */
function shown(events: TurnEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type === "narration") out.push(`- says: ${e.text}`);
    else if (e.type === "action") out.push(`- stage: ${JSON.stringify(e.action)}`);
    else if (e.type === "prompt") out.push(`- asks: ${e.text}${e.chips.length ? ` [${e.chips.join(" | ")}]` : ""}`);
    else if (e.type === "turn.done") out.push(`- done (move ${e.move})`);
    else if (e.type === "turn.error") out.push(`- FAILED (${e.reason}): ${e.message}`);
  }
  if (!events.some((e) => e.type === "turn.done" || e.type === "turn.error")) out.push("- stopped before the answer (interrupted or the page left)");
  return out;
}

export function logLiveTurn(sessionId: string, t: TurnRecord): string {
  const dir = sessionLogDeps.dir();
  mkdirSync(dir, { recursive: true });
  let file = files.get(sessionId);
  if (!file) {
    file = join(dir, `${t.startedAt.toISOString().replace(/[:.]/g, "-")}-${sessionId.slice(0, 8)}.md`);
    files.set(sessionId, file);
    appendFileSync(file, `# Live session ${sessionId.slice(0, 8)}\n\nStarted ${t.startedAt.toISOString()}. Laptop only; test-fixture content. Delete all logs: npm run live-sessions:delete\n`);
  }
  const lines = [
    "",
    `## Turn ${t.rev} · ${t.startedAt.toISOString()} · ${(t.latencyMs / 1000).toFixed(1)} s · ${(t.costMicroUsd / 1e6).toFixed(4)} USD (session ${(t.sessionCostMicroUsd / 1e6).toFixed(4)} USD)`,
    "",
    `**Learner:** ${t.learnerText}`,
    "",
    "**Shown:**",
    ...shown(t.events),
    "",
    `**Router:** ${t.router ? Object.entries(t.router).filter(([, v]) => v !== false && v !== null).map(([k, v]) => (v === true ? k : `${k}=${JSON.stringify(v)}`)).join(", ") || "nothing flagged" : "not reached"}`,
    "",
    "**Attempts:**",
    ...(t.attempts.length ? t.attempts.flatMap((a) => [`- attempt ${a.attempt}: ${a.outcome} · ${a.summary}`, ...a.errors.map((e) => `  - rejected: ${e}`), ...a.warnings.map((w) => `  - warning: ${w}`)]) : ["- none (refused or stopped before the professor answered)"]),
    "",
  ];
  appendFileSync(file, lines.join("\n"));
  return file;
}
