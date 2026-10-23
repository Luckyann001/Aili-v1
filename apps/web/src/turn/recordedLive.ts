import { directorResponseJsonSchema, ProviderDirector, ProviderRouter, professorPrompt, RecordedProvider, type ProfessorProvider, type Recording } from "@aili/engine";
import type { AiConfig } from "@aili/schemas";
import recording from "../../e2e/fixtures/live-recording.json";
import droneRecording from "../../e2e/fixtures/live-recording-drone.json";

// TEST BUILDS ONLY (docs/m3-live-browser-plan.md slice 6): the live route's provider-backed director
// and router, answered from a recording in the e2e fixtures instead of a model. No key, no network,
// no spend. Reached only through the "aili-recorded-live" alias (next.config.ts), which points here
// only when AILI_E2E_RECORDED_LIVE=1 at build time; every other build gets noRecordedLive.ts, so no
// production build contains this file or the recording.

const RECORDINGS = {
  main: recording as unknown as { router: Recording; professor: Recording },
  // The drone lesson's conversation (step 4 session 2), chosen by the test's cookie value.
  drone: droneRecording as unknown as { router: Recording; professor: Recording },
};

/**
 * The page's turn numbers depend on the page (its voice revision), so each recorded answer takes this
 * request's ID and revision from the prompt's session state. Everything else is as recorded.
 */
class RevAligned implements ProfessorProvider {
  constructor(private readonly inner: ProfessorProvider) {}
  async complete(req: Parameters<ProfessorProvider["complete"]>[0]) {
    const out = await this.inner.complete(req);
    const m = req.input.match(/<session_state>\n([\s\S]*?)\n<\/session_state>/);
    if (!m) return out;
    const state = JSON.parse(m[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) as { request_id: string; state_rev: number };
    return { ...out, json: { ...(out.json as object), request_id: state.request_id, state_rev: state.state_rev } };
  }
}

/** One recorded conversation per page session, so each page replays the recording from its start. */
const bySession = new Map<string, { professor: ProfessorProvider; router: ProfessorProvider }>();

function parts(config: AiConfig, sessionId: string, templates: { professor: string; router: string }, which: keyof typeof RECORDINGS = "main") {
  const rec = RECORDINGS[which];
  const key = `${which}:${sessionId}`;
  let p = bySession.get(key);
  if (!p) bySession.set(key, (p = { professor: new RevAligned(new RecordedProvider(rec.professor, "professor")), router: new RecordedProvider(rec.router, "router") }));
  return {
    director: new ProviderDirector({ provider: p.professor, config, hasKey: () => true, prompt: professorPrompt(templates.professor), outputSchema: directorResponseJsonSchema() }),
    router: new ProviderRouter({ provider: p.router, config, hasKey: () => true, template: templates.router }),
  };
}

/** Typed as "maybe absent" like the stand-in (noRecordedLive.ts), which every other build gets. */
export const recordedLiveParts: typeof parts | null = parts;
