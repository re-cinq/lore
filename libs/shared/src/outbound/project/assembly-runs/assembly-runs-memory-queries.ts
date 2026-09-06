import type {
  AssemblyRunQuery,
  AssemblyRunRecord,
  AssemblyRunSummary,
  OpenRunSummary,
  ClosedRunRef,
} from "./assembly-runs-port.js";

/** The graph-less projection the two open-run reads hand back. */
function toOpenSummary(row: AssemblyRunRecord): OpenRunSummary {
  return {
    id: row.id,
    status: row.status as "queued" | "running",
    repo: row.repo,
    branch: row.branch,
    subjectKey: row.subjectKey,
    createdAt: row.createdAt,
  };
}

function matchesRepoAndKind(
  row: AssemblyRunRecord,
  query: AssemblyRunQuery,
  blueprints: Set<string> | null,
  statuses: Set<string> | null,
): boolean {
  return (
    (query.repo === undefined || row.repo === query.repo) &&
    (blueprints === null || blueprints.has(row.blueprintName)) &&
    (statuses === null || statuses.has(row.status))
  );
}

function matchesTaskAndTiming(
  row: AssemblyRunRecord,
  query: AssemblyRunQuery,
): boolean {
  return (
    (query.taskId === undefined || row.taskId === query.taskId) &&
    (query.prNumber === undefined ||
      Number(row.args.pr_number) === query.prNumber) &&
    (query.createdAfter === undefined || row.createdAt >= query.createdAfter)
  );
}

/** Read-only queries (+ the PR-scoped finishOpenByPr write) over the SAME `rows` array reference `InMemoryAssemblyRuns` mutates via push — a copy here would silently go stale. */
export class AssemblyRunQueryStore {
  constructor(
    private readonly rows: AssemblyRunRecord[],
    private readonly clock: () => Date,
    private readonly hasOpenClaimByAgent: (
      runId: string,
      clusterAgentId: string,
    ) => boolean,
  ) {}

  private matchesSubjectAndClaim(
    row: AssemblyRunRecord,
    query: AssemblyRunQuery,
  ): boolean {
    return (
      (query.subjectKey === undefined || row.subjectKey === query.subjectKey) &&
      (query.clusterAgentId === undefined ||
        this.hasOpenClaimByAgent(row.id, query.clusterAgentId))
    );
  }

  private matchesRunQuery(
    row: AssemblyRunRecord,
    query: AssemblyRunQuery,
    blueprints: Set<string> | null,
    statuses: Set<string> | null,
  ): boolean {
    return (
      matchesRepoAndKind(row, query, blueprints, statuses) &&
      matchesTaskAndTiming(row, query) &&
      this.matchesSubjectAndClaim(row, query)
    );
  }

  list(query: AssemblyRunQuery): AssemblyRunRecord[] {
    const blueprints =
      query.blueprintName === undefined
        ? null
        : new Set(
            typeof query.blueprintName === "string"
              ? [query.blueprintName]
              : query.blueprintName,
          );
    const statuses = query.status ? new Set(query.status) : null;

    return this.rows
      .filter((row) => this.matchesRunQuery(row, query, blueprints, statuses))
      .sort(
        // Newest first, id tiebreak for stability (not chronology) — same-millisecond runs come back in a fixed but arbitrary order, as in Postgres.
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      )
      .slice(0, query.limit ?? 50);
  }

  listSummaries(query: AssemblyRunQuery): AssemblyRunSummary[] {
    // Same selection, graph dropped — the double must answer the narrower shape like Postgres, or tests would see a clone the deployed read never ships.
    return this.list(query).map(({ graph: _graph, ...summary }) => summary);
  }

  listOpen(): AssemblyRunRecord[] {
    return this.rows
      .filter((r) => r.status === "queued" || r.status === "running")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  findOpenOnBranch(repo: string, branch: string): OpenRunSummary[] {
    return this.listOpen()
      .filter((r) => r.repo === repo && r.branch === branch)
      .map(toOpenSummary);
  }

  findOpenBySubject(repo: string, subjectKey: string): OpenRunSummary | null {
    const open = this.listOpen().find(
      (r) => r.repo === repo && r.subjectKey === subjectKey,
    );

    return open ? toOpenSummary(open) : null;
  }

  countBySubject(repo: string, subjectKey: string): number {
    return this.rows.filter(
      (r) => r.repo === repo && r.subjectKey === subjectKey,
    ).length;
  }

  listForTask(taskId: string): AssemblyRunRecord[] {
    return this.rows
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private matchesOpenPr(
    row: AssemblyRunRecord,
    repo: string,
    prNumber: number,
  ): boolean {
    return (
      row.repo === repo &&
      Number(row.args.pr_number) === prNumber &&
      (row.status === "queued" || row.status === "running")
    );
  }

  findOpenByPr(repo: string, prNumber: number): AssemblyRunRecord[] {
    return this.rows
      .filter((r) => this.matchesOpenPr(r, repo, prNumber))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
    definitions?: readonly string[],
  ): ClosedRunRef[] {
    const open = this.rows.filter(
      (r) =>
        this.matchesOpenPr(r, repo, prNumber) &&
        (!definitions || definitions.includes(r.blueprintName)),
    );

    for (const row of open) {
      row.status = "finished";
      row.outcome = outcome;
      row.finishedAt = this.clock();
    }

    return open.map((row) => ({ id: row.id, taskId: row.taskId ?? null }));
  }

  hasReviewedPr(repo: string, prNumber: number): boolean {
    return this.rows.some(
      (r) =>
        r.repo === repo &&
        r.blueprintName === "code-review" &&
        Number(r.args.pr_number) === prNumber,
    );
  }
}
