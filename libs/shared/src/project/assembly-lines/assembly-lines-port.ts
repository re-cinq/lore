export interface AssemblyLineStartInput {
  definitionName: string;
  repo: string;
  branch?: string;
  taskId?: string;
  args?: Record<string, unknown>;
}

export interface AssemblyLineNodeStartInput {
  assemblyLineId: string;
  nodeId: string;
  iteration: number;
  agentCrName?: string;
}

export interface AssemblyLineNodeRecord {
  id: string;
  assemblyLineId: string;
  nodeId: string;
  iteration: number;
  outcome: string | null;
  agentCrName: string | null;
  commitSha: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface AssemblyLineRecord {
  id: string;
  definitionName: string;
  taskId: string | null;
  repo: string;
  branch: string | null;
  args: Record<string, unknown>;
  status: "queued" | "running" | "finished" | "failed";
  outcome: string | null;
  reason: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * `pipeline.assembly_lines` + `pipeline.assembly_line_nodes` — first-class
 * identity for one assembly line execution (per attempt, unlike the task id
 * which is stable across retries) plus the per-node trace.
 */
export interface AssemblyLinesPort {
  /**
   * Mint a fresh assemblyLineId, persist the row (status `queued`), and insert
   * the `assembly_line.start` event in the same atomic statement so the Floor
   * event loop picks the assembly line up. Returns the assemblyLineId.
   */
  start(input: AssemblyLineStartInput): Promise<string>;
  markRunning(id: string): Promise<void>;
  /** `outcome: "error"` closes the row as `failed`; anything else as `finished`.
   *  First writer decides — returns true only for the call that closed the row,
   *  so racing finishers (node event vs reaper) can gate once-only side effects
   *  (failure notification) on the win. */
  finish(id: string, outcome: string, reason?: string): Promise<boolean>;
  getById(id: string): Promise<AssemblyLineRecord | null>;
  listForTask(taskId: string): Promise<AssemblyLineRecord[]>;
  /**
   * Event-driven transition primitives: the walk state is derived from node rows,
   * so duplicate/concurrent advancers must converge structurally.
   */
  /** Insert-or-noop on the UNIQUE (assembly_line_id, node_id, iteration) key. */
  ensureNodeStart(
    input: AssemblyLineNodeStartInput,
  ): Promise<{ nodeRowId: string; created: boolean }>;
  /** Compare-and-set the outcome (`WHERE outcome IS NULL`); true when this call won. */
  finishNodeOnce(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
  ): Promise<boolean>;
  /** The line's node rows in visit order (row id). */
  listNodes(assemblyLineId: string): Promise<AssemblyLineNodeRecord[]>;
  /** Open (`queued`/`running`) lines, oldest first — the reaper's work list. */
  listOpen(): Promise<AssemblyLineRecord[]>;
  /**
   * Open (`queued`/`running`) assembly lines whose `args.pr_number` matches — the
   * PR-scoped lookup the code-review choreography uses. Only code-review lines
   * carry `pr_number` in args, so this is naturally scoped to them.
   */
  findOpenByPr(repo: string, prNumber: number): Promise<AssemblyLineRecord[]>;
  /** Close every open line for the repo+PR with `outcome`; returns the count closed. */
  finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
  ): Promise<number>;
  /**
   * True when any `code-review` line (any status) has ever run for the repo+PR —
   * the first-review-only guard so pushes after the first review don't re-review.
   */
  hasReviewedPr(repo: string, prNumber: number): Promise<boolean>;
}
