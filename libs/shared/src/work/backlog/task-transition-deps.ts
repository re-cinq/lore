/** The CAS + event-record pair every terminal task-status write goes through, shared by the sweeps that settle a `pipeline.tasks` row outside its own line (loop-reap, loop-merge-success). */
export interface TaskTransitionDeps {
  setStatusIf(
    id: string,
    expectedStatus: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<boolean>;
  recordEvent(
    id: string,
    fromStatus: string | null,
    toStatus: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void>;
}
