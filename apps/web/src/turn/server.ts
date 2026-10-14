import { createFakeDirector, createFakeRouter, encodeEvent, InMemoryLedger, InMemorySessionStore, killSwitchFromEnv, TurnSession, type SessionState, type TurnEvent } from "@aili/engine";
import { AiConfig, InterruptRequest, TurnRequest } from "@aili/schemas";
import aiConfigJson from "../../../../config/ai.json";
import { FAKE_DIRECTOR } from "./flags";
import { isLocalRequest, LIVE_CONCEPTS, LIVE_LEVEL, liveEnabled, liveTurnParts, logCheck, summarizeAttempt } from "./live";
import { logLiveTurn, type LoggedAttempt } from "./sessionLog";

// Handlers behind POST /api/turn and POST /api/turn/interrupt (M2 slice 6). Two modes:
// - the fake director (NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1): no provider, no key, no network;
// - live (AILI_LIVE=1, a dev server on this laptop only, local requests only; see live.ts): the
//   provider-backed director and router, with the kill switch, live key checks and session cap.
// Live wins when both are on. With neither, both routes return 404.

// "aili-turn-fixtures" is a build-time alias (next.config.ts): the real fixture registry only for the
// fake-director flag or a live dev server, otherwise a stub with no fixture data, so production
// builds never contain the files.
const loadFixtureRegistry = () => import("aili-turn-fixtures");

// Prices and the session cap come only from config/ai.json, validated once at start-up.
const aiConfig = AiConfig.safeParse(aiConfigJson);

/**
 * Cost per page session (slice 7). IN MEMORY ONLY: lost on restart and separate on each server
 * instance. Per-user and global caps need the database (deferred stage).
 */
export const ledger = new InMemoryLedger();

/**
 * Session state lives HERE, never in the client (M3 hard rule): history, open prompt, scene on
 * stage. In memory only: lost on restart and separate per server instance (database stage later).
 */
export const sessions = new InMemorySessionStore();
// The level starts "unknown": the learner has not said it (Lucky's decision 2026-10-13).
const fresh = (): SessionState => ({ history: { posture: "learning", learner_level: "unknown", entries: [] } });

/** The turn in flight for each page session: a newer turn stops the older one. */
const inFlight = new Map<string, TurnSession>();

/** How long the "slow" case waits, so a person (or a test) can interrupt it. */
export const SLOW_MS = 3000;
const TIMEOUT_MS = 10_000;

/**
 * Turns in flight on THIS server instance, keyed by client session and turn ID (turn IDs repeat
 * across pages). An interrupt on another instance cannot reach them.
 */
const running = new Map<string, TurnSession>();

const notFound = () => new Response("Not found", { status: 404 });
const badRequest = (issues: string[]) => Response.json({ error: "bad request", issues }, { status: 400 });
const notLocal = () => Response.json({ error: "Live answers only take requests from this computer." }, { status: 403 });

/** Which mode answers this request, or the response that refuses it. */
function mode(request: Request): "live" | "fake" | Response {
  if (liveEnabled()) return isLocalRequest(request) ? "live" : notLocal();
  return FAKE_DIRECTOR ? "fake" : notFound();
}

export async function handleTurn(request: Request): Promise<Response> {
  const m = mode(request);
  if (m instanceof Response) return m;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(["the body is not JSON"]);
  }
  const parsed = TurnRequest.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`));
  const req = parsed.data;

  if (!aiConfig.success) return Response.json({ error: "config/ai.json is invalid", issues: aiConfig.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 500 });
  const { registry, errors } = (await loadFixtureRegistry()).fixtureTurnRegistry();
  if (errors.length) return Response.json({ error: "the test-fixture registry did not load", issues: errors }, { status: 500 });

  // A newer turn from the same page stops the older one (its state is never committed).
  inFlight.get(req.session_id)?.interrupt();
  const start = sessions.get(req.session_id) ?? fresh();
  // Live: the case field is ignored; the turn budget comes from config (turn and attempt timeouts).
  const live = m === "live" ? liveTurnParts(aiConfig.data) : null;
  // Live only: what the local session log keeps for this turn (slice 5).
  const startedAt = new Date();
  const attempts: LoggedAttempt[] = [];
  const sent: TurnEvent[] = [];
  let routed: Record<string, unknown> | null = null;
  const terminalLog = logCheck(req.session_id, req.state_rev);
  const session = new TurnSession({
    registry,
    director: live ? live.director : createFakeDirector(req.case, { slowMs: SLOW_MS }),
    router: live ? live.router : createFakeRouter(),
    state: start,
    concepts: live ? LIVE_CONCEPTS : ["mech.torque.static"],
    level: live ? LIVE_LEVEL : "L2",
    startRev: req.state_rev - 1,
    ...(live
      ? {
          onCheck: (c: Parameters<typeof terminalLog>[0]) => {
            terminalLog(c);
            attempts.push({ attempt: c.attempt, outcome: c.outcome, summary: summarizeAttempt(c.raw), errors: c.errors, warnings: c.warnings });
          },
          onRoute: (r: { classification: object }) => (routed = { ...r.classification }),
        }
      : { timeoutMs: TIMEOUT_MS }),
    // The kill switch is read on every request (server-only env, so it can be flipped without a rebuild).
    meter: { ledger, sessionId: req.session_id, config: aiConfig.data, killSwitch: killSwitchFromEnv(process.env), ...(live ? { live: live.live } : {}) },
  });
  const spentBefore = ledger.spent(req.session_id);
  const key = `${req.session_id}/turn_${req.state_rev}`;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      running.set(key, session);
      inFlight.set(req.session_id, session);
      const emit = (e: TurnEvent) => {
        if (live) sent.push(e);
        try {
          controller.enqueue(enc.encode(encodeEvent(e)));
        } catch {
          session.interrupt(); // the client has gone: stop the turn
        }
      };
      try {
        await session.run(req.input, emit);
        // Only a completed turn changes the session's state; an older turn finishing late cannot.
        if (session.state !== start) sessions.commit(req.session_id, req.state_rev, session.state);
      } finally {
        // Live cost to the dev server's terminal (no learner text, no key): this turn and this page session.
        if (live) {
          console.error(`[live] session ${req.session_id.slice(0, 8)} turn ${req.state_rev}: ${((ledger.spent(req.session_id) - spentBefore) / 1e6).toFixed(4)} USD, page session ${(ledger.spent(req.session_id) / 1e6).toFixed(4)} USD`);
          // The local session log (laptop only, git-ignored). A failure to write never breaks the turn.
          try {
            logLiveTurn(req.session_id, { rev: req.state_rev, startedAt, latencyMs: Date.now() - startedAt.getTime(), learnerText: req.input.text, router: routed, attempts, events: sent, costMicroUsd: ledger.spent(req.session_id) - spentBefore, sessionCostMicroUsd: ledger.spent(req.session_id) });
          } catch (err) {
            console.error(`[live] the session log could not be written: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        running.delete(key);
        if (inFlight.get(req.session_id) === session) inFlight.delete(req.session_id);
        try {
          controller.close();
        } catch {
          // already closed by a cancel
        }
      }
    },
    cancel() {
      // The client closed the stream (an interrupt or a dropped connection).
      session.interrupt();
      running.delete(key);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

export async function handleInterrupt(request: Request): Promise<Response> {
  const m = mode(request);
  if (m instanceof Response) return m;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(["the body is not JSON"]);
  }
  const parsed = InterruptRequest.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`));
  const key = `${parsed.data.session_id}/${parsed.data.request_id}`;
  const s = running.get(key);
  if (!s || s.revision !== parsed.data.state_rev) return Response.json({ stopped: false }); // finished, unknown, another session or instance
  s.interrupt();
  running.delete(key);
  return Response.json({ stopped: true });
}
