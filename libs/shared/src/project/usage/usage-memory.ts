import type {
  UsagePort,
  LlmCallRecord,
  LlmCallResult,
  ProcessedCounts,
} from "./usage-port.js";

/** A `pipeline.llm_calls` row as the double persists it. */
export interface StoredLlmCall {
  task_id: string | null;
  assembly_line_id: string | null;
  station_run_id: string | null;
  job_name: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  status: "success" | "failed";
  error: string | null;
  created_at: Date;
}

/** Seed for the write-time correlation against `assembly_line_nodes`. */
export interface SeedUsageNode {
  agentCrName: string;
  assemblyLineId: string;
  /** The visit's own id; optional because a node seeded before station-run identity has none. */
  stationRunId?: string | null;
}

/** In-memory {@link UsagePort}: the behavioral spec of the Pg adapter; uncorrelated rows are kept, not rejected (#945). */
export class InMemoryUsage implements UsagePort {
  readonly rows: StoredLlmCall[] = [];
  private readonly taskIds = new Set<string>();
  private readonly assemblyLineIds = new Set<string>();
  private readonly nodes: SeedUsageNode[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Seed a `pipeline.tasks` id (the `t.id = g.given` join). */
  registerTask(id: string): void {
    this.taskIds.add(id);
  }

  /** Seed a `pipeline.assembly_runs` id (the `al.id = g.given` fallback join). */
  registerAssemblyLine(id: string): void {
    this.assemblyLineIds.add(id);
  }

  /** Seed an `assembly_line_nodes` row; the LAST matching registration wins, mirroring `ORDER BY n.id DESC LIMIT 1`. */
  registerNode(node: SeedUsageNode): void {
    this.nodes.push(node);
  }

  async logLlmCall(record: LlmCallRecord): Promise<LlmCallResult> {
    // Not modeled: Pg casts the given id with `::uuid`, erroring on a non-uuid string rather than storing uncorrelated — seed valid uuids.
    const given = record.taskId ?? null;
    const taskId = given !== null && this.taskIds.has(given) ? given : null;
    // The lateral join is independent of the task join; a NULL CR matches no node.
    const node =
      record.agentCrName == null
        ? undefined
        : [...this.nodes]
            .reverse()
            .find((n) => n.agentCrName === record.agentCrName);
    const lineFromGiven =
      taskId === null && given !== null && this.assemblyLineIds.has(given)
        ? given
        : null;
    // Stated beats both guesses, and beats them WHOLE: a carried identity brings its own station run, never the lateral's.
    const assemblyLineId =
      record.carried?.assemblyRunId ?? node?.assemblyLineId ?? lineFromGiven;
    const stationRunId = record.carried
      ? record.carried.stationRunId
      : (node?.stationRunId ?? null);

    this.rows.push({
      task_id: taskId,
      assembly_line_id: assemblyLineId,
      station_run_id: stationRunId,
      job_name: record.jobName ?? null,
      model: record.model,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      cost_usd: record.costUsd ?? 0,
      duration_ms: record.durationMs,
      status: record.status ?? "success",
      error: record.error ?? null,
      created_at: this.now(),
    });

    return { correlated: taskId !== null || assemblyLineId !== null };
  }

  async processedCounts(): Promise<ProcessedCounts> {
    // `created_at > current_date` — rows after local midnight of the clock.
    const now = this.now();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const today = this.rows.filter(
      (r) => r.created_at.getTime() > midnight.getTime(),
    ).length;

    return { today, total: this.rows.length };
  }

  async modelsUsed(stationRunId: string): Promise<string[]> {
    return [
      ...new Set(
        this.rows
          .filter((r) => r.station_run_id === stationRunId && r.model !== "")
          .map((r) => r.model),
      ),
    ].sort();
  }
}
