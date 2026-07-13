import { randomUUID } from "node:crypto";
import type {
  AssemblyLinesPort,
  AssemblyLineStartInput,
  AssemblyLineNodeStartInput,
  AssemblyLineRecord,
} from "./assembly-lines-port.js";

export interface SeedAssemblyLineEvent {
  eventName: string;
  source: string;
  params: Record<string, unknown>;
  dedupeKey: string;
}

export interface SeedAssemblyLineNode {
  id: string;
  assemblyLineId: string;
  nodeId: string;
  iteration: number;
  agentCrName: string | null;
  outcome: string | null;
  commitSha: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/**
 * In-memory {@link AssemblyLinesPort}: the behavioral spec of the Pg adapter,
 * computed over seeded rows. `clock` is injectable so ordering-dependent reads
 * are deterministic in tests.
 */
export class InMemoryAssemblyLines implements AssemblyLinesPort {
  rows: AssemblyLineRecord[] = [];
  nodes: SeedAssemblyLineNode[] = [];
  events: SeedAssemblyLineEvent[] = [];

  constructor(public clock: () => Date = () => new Date()) {}

  async start(input: AssemblyLineStartInput): Promise<string> {
    const id = randomUUID();
    this.rows.push(this.newRow(id, input));
    this.events.push({
      eventName: "assembly_line.start",
      source: "internal",
      params: {
        assemblyLineId: id,
        definitionName: input.definitionName,
        repo: input.repo,
        branch: input.branch ?? null,
        taskId: input.taskId ?? null,
        args: input.args ?? {},
      },
      dedupeKey: `assembly_line.start:${id}`,
    });
    return id;
  }

  async markRunning(id: string): Promise<void> {
    const row = this.mustFind(id);
    row.status = "running";
    row.startedAt = this.clock();
  }

  async finish(id: string, outcome: string, reason?: string): Promise<void> {
    const row = this.mustFind(id);
    row.status = outcome === "error" ? "failed" : "finished";
    row.outcome = outcome;
    row.reason = reason ?? null;
    row.finishedAt = this.clock();
  }

  async recordNodeStart(input: AssemblyLineNodeStartInput): Promise<string> {
    const id = String(this.nodes.length + 1);
    this.nodes.push({
      id,
      assemblyLineId: input.assemblyLineId,
      nodeId: input.nodeId,
      iteration: input.iteration,
      agentCrName: input.agentCrName ?? null,
      outcome: null,
      commitSha: null,
      startedAt: this.clock(),
      finishedAt: null,
    });
    return id;
  }

  async recordNodeFinish(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
  ): Promise<void> {
    const node = this.nodes.find((n) => n.id === nodeRowId);
    if (!node) throw new Error(`no assembly line node row "${nodeRowId}"`);
    node.outcome = outcome;
    node.commitSha = commitSha ?? null;
    node.finishedAt = this.clock();
  }

  async getById(id: string): Promise<AssemblyLineRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async listForTask(taskId: string): Promise<AssemblyLineRecord[]> {
    return this.rows
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findOpenByPr(
    repo: string,
    prNumber: number,
  ): Promise<AssemblyLineRecord[]> {
    return this.rows
      .filter((r) => this.matchesOpenPr(r, repo, prNumber))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
  ): Promise<number> {
    const open = this.rows.filter((r) => this.matchesOpenPr(r, repo, prNumber));
    for (const row of open) {
      row.status = "finished";
      row.outcome = outcome;
      row.finishedAt = this.clock();
    }
    return open.length;
  }

  private matchesOpenPr(
    row: AssemblyLineRecord,
    repo: string,
    prNumber: number,
  ): boolean {
    return (
      row.repo === repo &&
      Number(row.args.pr_number) === prNumber &&
      (row.status === "queued" || row.status === "running")
    );
  }

  private newRow(
    id: string,
    input: AssemblyLineStartInput,
  ): AssemblyLineRecord {
    return {
      id,
      definitionName: input.definitionName,
      taskId: input.taskId ?? null,
      repo: input.repo,
      branch: input.branch ?? null,
      args: input.args ?? {},
      status: "queued",
      outcome: null,
      reason: null,
      createdAt: this.clock(),
      startedAt: null,
      finishedAt: null,
    };
  }

  private mustFind(id: string): AssemblyLineRecord {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no assembly line "${id}"`);
    return row;
  }
}
