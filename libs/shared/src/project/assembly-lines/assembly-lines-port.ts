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
  /** `outcome: "error"` closes the row as `failed`; anything else as `finished`. */
  finish(id: string, outcome: string, reason?: string): Promise<void>;
  /** Returns the node row id used by {@link recordNodeFinish}. */
  recordNodeStart(input: AssemblyLineNodeStartInput): Promise<string>;
  recordNodeFinish(nodeRowId: string, outcome: string, commitSha?: string): Promise<void>;
  getById(id: string): Promise<AssemblyLineRecord | null>;
  listForTask(taskId: string): Promise<AssemblyLineRecord[]>;
}
