import type { SessionState } from "./turn";

// Server-side session state (M3 hard rule, docs/m2-plan.md §9): the history, the open prompt and
// the scene on stage live here, never in the client. IN MEMORY ONLY until the database stage:
// lost on restart and separate on each server instance. Bounded, with an idle expiry.

export interface SessionStore {
  /** The session's committed state, or undefined if none (or it expired). */
  get(sessionId: string): SessionState | undefined;
  /** Save the state a COMPLETED turn produced. Ignored if a newer revision was already saved. */
  commit(sessionId: string, rev: number, state: SessionState): boolean;
  /** Change the state saved by turn `rev` (an interrupt mid-speech; M4 slice 1). Ignored unless `rev` is the latest saved. */
  amend(sessionId: string, rev: number, change: (s: SessionState) => SessionState): boolean;
}

export class InMemorySessionStore implements SessionStore {
  private readonly map = new Map<string, { rev: number; state: SessionState; at: number }>();
  constructor(private readonly opts: { maxSessions?: number; idleMs?: number; now?: () => number } = {}) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  get(sessionId: string): SessionState | undefined {
    const e = this.map.get(sessionId);
    if (!e) return undefined;
    if (this.now() - e.at > (this.opts.idleMs ?? 2 * 60 * 60 * 1000)) {
      this.map.delete(sessionId);
      return undefined;
    }
    e.at = this.now();
    this.map.delete(sessionId); // move to the end: most recently used
    this.map.set(sessionId, e);
    return e.state;
  }

  amend(sessionId: string, rev: number, change: (s: SessionState) => SessionState): boolean {
    const e = this.map.get(sessionId);
    if (!e || e.rev !== rev) return false;
    e.state = change(e.state);
    e.at = this.now();
    return true;
  }

  commit(sessionId: string, rev: number, state: SessionState): boolean {
    const e = this.map.get(sessionId);
    if (e && e.rev >= rev) return false; // a newer (or the same) turn already saved its state
    this.map.delete(sessionId);
    this.map.set(sessionId, { rev, state, at: this.now() });
    const max = this.opts.maxSessions ?? 500;
    while (this.map.size > max) this.map.delete(this.map.keys().next().value!); // drop the least recently used
    return true;
  }
}
