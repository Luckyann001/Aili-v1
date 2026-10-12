import { createFakeDirector, encodeEvent, TurnSession, type TurnEvent } from "@aili/engine";
import { InterruptRequest, TurnRequest } from "@aili/schemas";
import { FAKE_DIRECTOR } from "./flags";

// Handlers behind POST /api/turn and POST /api/turn/interrupt (M2 slice 6). Fake director only:
// no provider, no key, no network. Without NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1 both return 404, and
// the fixture registry import below is folded away at build time.

const loadFixtureRegistry = FAKE_DIRECTOR ? () => import("./fixtureRegistry") : null;

/** How long the "slow" case waits, so a person (or a test) can interrupt it. */
export const SLOW_MS = 3000;
const TIMEOUT_MS = 10_000;

/** Turns in flight on THIS server instance (an interrupt on another instance cannot reach them). */
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

  const { registry, errors } = (await loadFixtureRegistry()).fixtureTurnRegistry();
  if (errors.length) return Response.json({ error: "the test-fixture registry did not load", issues: errors }, { status: 500 });

  const session = new TurnSession({
    registry,
    director: createFakeDirector(req.case, { slowMs: SLOW_MS }),
    state: { history: req.state.history, activeScene: req.state.active_scene },
    concepts: ["mech.torque.static"],
    level: "L2",
    startRev: req.state_rev - 1,
    timeoutMs: TIMEOUT_MS,
    includeStateInDone: true,
  });
  const turnId = `turn_${req.state_rev}`;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      running.set(turnId, session);
      const emit = (e: TurnEvent) => {
        try {
          controller.enqueue(enc.encode(encodeEvent(e)));
        } catch {
          session.interrupt(); // the client has gone: stop the turn
        }
      };
      try {
        await session.run(req.input, emit);
      } finally {
        running.delete(turnId);
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
      running.delete(turnId);
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
  const s = running.get(parsed.data.request_id);
  if (!s || s.revision !== parsed.data.state_rev) return Response.json({ stopped: false }); // finished, unknown or another instance
  s.interrupt();
  running.delete(parsed.data.request_id);
  return Response.json({ stopped: true });
}
