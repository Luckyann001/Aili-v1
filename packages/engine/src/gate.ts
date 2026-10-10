// Stale-action gate for scripted beats, matching the voice machine's rule (apps/web/src/voice):
// every action carries the revision it was queued under and a sequence number. An interrupt or a
// new question starts a new revision, so actions queued earlier are dropped even if a timer
// fires late; within a revision, repeated or out-of-order sequence numbers are dropped.

export interface Stamped<T> {
  rev: number;
  seq: number;
  action: T;
}

export interface GateState {
  rev: number;
  lastSeq: number;
}

export const initialGate: GateState = { rev: 0, lastSeq: -1 };

/** An interrupt or a new learner input: anything queued before is now stale. */
export const nextRevision = (g: GateState): GateState => ({ rev: g.rev + 1, lastSeq: -1 });

export function stamp<T>(actions: readonly T[], rev: number): Stamped<T>[] {
  return actions.map((action, seq) => ({ rev, seq, action }));
}

/** Admit an action only if it belongs to the current revision and comes after the last one. */
export function admit<T>(g: GateState, a: Stamped<T>): { ok: boolean; gate: GateState } {
  if (a.rev !== g.rev || a.seq <= g.lastSeq) return { ok: false, gate: g };
  return { ok: true, gate: { rev: g.rev, lastSeq: a.seq } };
}
