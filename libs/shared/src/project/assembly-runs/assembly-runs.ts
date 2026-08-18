import type {
  AssemblyRunsPort,
  AssemblyRunStartInput,
  AssemblyRunRecord,
  StationRunRecord,
} from "./assembly-runs-port.js";

/**
 * Repo-scoped facade over {@link AssemblyRunsPort}: fills `repo` from the
 * Project's fullName so callers write
 * `project.assemblyRuns.start("implementation", { taskId })`.
 */
export class AssemblyRuns {
  constructor(
    private readonly repo: string,
    private readonly port: AssemblyRunsPort,
  ) {}

  /** Fire-and-observe: returns the minted assemblyLineId immediately; the Floor event loop runs it. */
  start(
    blueprintName: string,
    opts: Omit<AssemblyRunStartInput, "blueprintName" | "repo"> = {},
  ): Promise<string> {
    return this.port.start({ blueprintName, repo: this.repo, ...opts });
  }

  getById(id: string): Promise<AssemblyRunRecord | null> {
    return this.port.getById(id);
  }

  /** Merge a produced artifact (or a node's objection) into the line's args. */
  mergeArgs(id: string, patch: Record<string, unknown>): Promise<void> {
    return this.port.mergeArgs(id, patch);
  }

  listForTask(taskId: string): Promise<AssemblyRunRecord[]> {
    return this.port.listForTask(taskId);
  }

  /** The line's node rows — how a reader tells which node it is parked on. */
  listStationRuns(id: string): Promise<StationRunRecord[]> {
    return this.port.listStationRuns(id);
  }

  findOpenByPr(prNumber: number): Promise<AssemblyRunRecord[]> {
    return this.port.findOpenByPr(this.repo, prNumber);
  }

  finishOpenByPr(
    prNumber: number,
    outcome: string,
    definitions?: readonly string[],
  ): Promise<number> {
    return this.port.finishOpenByPr(this.repo, prNumber, outcome, definitions);
  }

  hasReviewedPr(prNumber: number): Promise<boolean> {
    return this.port.hasReviewedPr(this.repo, prNumber);
  }
}
