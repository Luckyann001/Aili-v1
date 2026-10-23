import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isLocalRequest } from "./live";

// The local demand log (step 4 session 2, docs/drone-pid-plan.md): a learner's "Tell me when it's ready"
// is noted as interest in a lesson that does not exist yet. LAPTOP ONLY until the database stage: one
// line per tap in the git-ignored `live-sessions/demand.md` at the repo root (with the live session logs;
// `npm run live-sessions:delete` removes it). Nothing about the learner is written, only the topic and
// where it was asked. Written on a dev server only; a testing build answers without writing; a
// production build returns 404.

export const DemandRequest = z
  .object({
    topic: z.enum(["learned-controllers"]),
    from: z.enum(["drone-pid lesson"]),
  })
  .strict();

export const demandLogDeps = { dir: () => join(process.cwd(), "..", "..", "live-sessions"), now: () => new Date() };

type Env = Record<string, string | undefined>;
export type DemandMode = "write" | "test" | "off";

/** Where the log may be written: a dev server (write), a testing build with the fake director (test, nothing written), else off. */
export function demandMode(env: Env = process.env): DemandMode {
  if (env.NODE_ENV === "development") return "write";
  if (env.NEXT_PUBLIC_AILI_FAKE_DIRECTOR === "1") return "test";
  return "off";
}

export async function handleDemand(request: Request, env: Env = process.env): Promise<Response> {
  const mode = demandMode(env);
  if (mode === "off" || !isLocalRequest(request, env)) return new Response("Not found", { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "the request is not JSON" }, { status: 400 });
  }
  const parsed = DemandRequest.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "unknown topic or place" }, { status: 400 });
  if (mode === "test") return Response.json({ ok: true, written: false });
  const dir = demandLogDeps.dir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "demand.md"), `- ${demandLogDeps.now().toISOString()} · ${parsed.data.topic} · asked from the ${parsed.data.from}\n`);
  return Response.json({ ok: true, written: true });
}
