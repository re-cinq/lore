import type {
  AssemblyLinesPort,
  AssemblyLineStartInput,
  AssemblyLineRecord,
  AssemblyLineNodeRecord,
} from "./assembly-lines-port.js";

/**
 * Repo-scoped facade over {@link AssemblyLinesPort}: fills `repo` from the
 * Project's fullName so callers write
 * `project.assemblyLines.start("implementation", { taskId })`.
 */
export class AssemblyLines {
  constructor(
    private readonly repo: string,
    private readonly port: AssemblyLinesPort,
  ) {}

  /** Fire-and-observe: returns the minted assemblyLineId immediately; the Floor event loop runs it. */
  start(
    definitionName: string,
    opts: Omit<AssemblyLineStartInput, "definitionName" | "repo"> = {},
  ): Promise<string> {
    return this.port.start({ definitionName, repo: this.repo, ...opts });
  }

  getById(id: string): Promise<AssemblyLineRecord | null> {
    return this.port.getById(id);
  }

  /** Merge a produced artifact (or a node's objection) into the line's args. */
  mergeArgs(id: string, patch: Record<string, unknown>): Promise<void> {
    return this.port.mergeArgs(id, patch);
  }

  listForTask(taskId: string): Promise<AssemblyLineRecord[]> {
    return this.port.listForTask(taskId);
  }

  /** The line's node rows — how a reader tells which node it is parked on. */
  listNodes(id: string): Promise<AssemblyLineNodeRecord[]> {
    return this.port.listNodes(id);
  }

  findOpenByPr(prNumber: number): Promise<AssemblyLineRecord[]> {
    return this.port.findOpenByPr(this.repo, prNumber);
  }

  finishOpenByPr(prNumber: number, outcome: string): Promise<number> {
    return this.port.finishOpenByPr(this.repo, prNumber, outcome);
  }

  hasReviewedPr(prNumber: number): Promise<boolean> {
    return this.port.hasReviewedPr(this.repo, prNumber);
  }
}
