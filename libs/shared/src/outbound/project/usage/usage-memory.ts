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

function resolveTaskId(
  given: string | null,
  taskIds: Set<string>,
): string | null {
  return given !== null && taskIds.has(given) ? given : null;
}

/** The lateral join is independent of the task join; a NULL CR matches no node. Last matching registration wins, mirroring `ORDER BY n.id DESC LIMIT 1`. */
function findMatchingNode(
  nodes: SeedUsageNode[],
  agentCrName: string | null | undefined,
): SeedUsageNode | undefined {
  if (agentCrName == null) {
    return undefined;
  }

  return [...nodes].reverse().find((n) => n.agentCrName === agentCrName);
}

function resolveLineFromGiven(
  taskId: string | null,
  given: string | null,
  assemblyLineIds: Set<string>,
): string | null {
  if (taskId !== null || given === null) {
    return null;
  }

  return assemblyLineIds.has(given) ? given : null;
}

/** Stated beats both guesses, and beats them WHOLE: a carried identity brings its own station run, never the lateral's. */
function resolveAssemblyLineId(
  record: LlmCallRecord,
  node: SeedUsageNode | undefined,
  lineFromGiven: string | null,
): string | null {
  return record.carried?.assemblyRunId ?? node?.assemblyLineId ?? lineFromGiven;
}

function resolveStationRunId(
  record: LlmCallRecord,
  node: SeedUsageNode | undefined,
): string | null {
  return record.carried
    ? record.carried.stationRunId
    : (node?.stationRunId ?? null);
}

interface NormalizedLlmCallDefaults {
  jobName: string | null;
  costUsd: number;
  status: "success" | "failed";
  error: string | null;
}

function normalizeLlmCallDefaults(
  record: LlmCallRecord,
): NormalizedLlmCallDefaults {
  return {
    jobName: record.jobName ?? null,
    costUsd: record.costUsd ?? 0,
    status: record.status ?? "success",
    error: record.error ?? null,
  };
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

  // Not modeled: Pg casts the given id with `::uuid`, erroring on a non-uuid string rather than storing uncorrelated — seed valid uuids.
  async logLlmCall(record: LlmCallRecord): Promise<LlmCallResult> {
    const given = record.taskId ?? null;
    const taskId = resolveTaskId(given, this.taskIds);
    const node = findMatchingNode(this.nodes, record.agentCrName);
    const lineFromGiven = resolveLineFromGiven(
      taskId,
      given,
      this.assemblyLineIds,
    );
    const assemblyLineId = resolveAssemblyLineId(record, node, lineFromGiven);
    const stationRunId = resolveStationRunId(record, node);
    const defaults = normalizeLlmCallDefaults(record);

    this.rows.push({
      task_id: taskId,
      assembly_line_id: assemblyLineId,
      station_run_id: stationRunId,
      job_name: defaults.jobName,
      model: record.model,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      cost_usd: defaults.costUsd,
      duration_ms: record.durationMs,
      status: defaults.status,
      error: defaults.error,
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
