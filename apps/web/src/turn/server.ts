import { createFakeDirector, createFakeRouter, encodeEvent, InMemoryLedger, InMemorySessionStore, killSwitchFromEnv, TurnSession, type SessionState, type TurnEvent } from "@aili/engine";
import { AiConfig, InterruptRequest, TurnRequest } from "@aili/schemas";
import aiConfigJson from "../../../../config/ai.json";
import { FAKE_DIRECTOR } from "./flags";

// Handlers behind POST /api/turn and POST /api/turn/interrupt (M2 slice 6). Fake director only:
// no provider, no key, no network. Without NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1 both return 404, and
// the fixture registry import below is folded away at build time.

// "aili-turn-fixtures" is a build-time alias (next.config.ts): the real fixture registry only when the
// flag is set, otherwise a stub with no fixture data, so production builds never contain the files.
const loadFixtureRegistry = FAKE_DIRECTOR ? () => import("aili-turn-fixtures") : null;

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
const fresh = (): SessionState => ({ history: { posture: "learning", learner_level: "some_knowledge", entries: [] } });

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

export async function handleTurn(request: Request): Promise<Response> {
  if (!loadFixtureRegistry) return notFound();
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
  const session = new TurnSession({
    registry,
    director: createFakeDirector(req.case, { slowMs: SLOW_MS }),
    router: createFakeRouter(),
    state: start,
    concepts: ["mech.torque.static"],
    level: "L2",
    startRev: req.state_rev - 1,
    timeoutMs: TIMEOUT_MS,
    // The kill switch is read on every request (server-only env, so it can be flipped without a rebuild).
    meter: { ledger, sessionId: req.session_id, config: aiConfig.data, killSwitch: killSwitchFromEnv(process.env) },
  });
  const key = `${req.session_id}/turn_${req.state_rev}`;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      running.set(key, session);
      inFlight.set(req.session_id, session);
      const emit = (e: TurnEvent) => {
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
  if (!FAKE_DIRECTOR) return notFound();
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
