import { reportWithHistory } from "./report-history.js";
import {
  REPORT_HISTORY_DEPTH,
  type NewTestReport,
  type TestReportRow,
  type TestReportsRepository,
} from "./test-reports-port.js";

function newestFirst(a: TestReportRow, b: TestReportRow): number {
  return (
    b.receivedAt.getTime() - a.receivedAt.getTime() ||
    Number(b.id) - Number(a.id)
  );
}

/** In-memory {@link TestReportsRepository} with the Pg contract: one row per (repo, commit), newest receivedAt wins per branch. Inject `now` for deterministic ordering. */
export class InMemoryTestReports implements TestReportsRepository {
  // eslint-disable-next-line re-lint/no-duplicate-code -- the double's deterministic-clock preamble, shared by shape with the agent-run-events double and by nothing else; see that file for why the two are not folded together
  readonly rows: TestReportRow[] = [];
  private readonly now: () => Date;
  private nextId = 1;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  async upsertLatest(report: NewTestReport): Promise<TestReportRow> {
    const existing = this.rows.findIndex(
      (row) => row.repo === report.repo && row.commit === report.commit,
    );
    const id = existing === -1 ? String(this.nextId++) : this.rows[existing].id;
    const row: TestReportRow = { ...report, id, receivedAt: this.now() };

    this.rows.splice(existing === -1 ? this.rows.length : existing, 1, row);

    return row;
  }

  async latestForBranch(
    repo: string,
    branch: string,
  ): Promise<TestReportRow | null> {
    const onBranch = this.rows
      .filter((row) => row.repo === repo && row.branch === branch)
      .sort(newestFirst);

    return onBranch[0] ?? null;
  }

  async forCommit(repo: string, commit: string): Promise<TestReportRow | null> {
    return (
      this.rows.find((row) => row.repo === repo && row.commit === commit) ??
      null
    );
  }

  async forCommitWithHistory(
    repo: string,
    commit: string,
  ): Promise<TestReportRow | null> {
    const head = await this.forCommit(repo, commit);

    if (!head) {
      return null;
    }
    const earlier = this.rows
      .filter(
        (row) =>
          row.repo === repo &&
          row.branch === head.branch &&
          row.commit !== commit &&
          row.receivedAt <= head.receivedAt,
      )
      .sort(newestFirst)
      .slice(0, REPORT_HISTORY_DEPTH);

    return reportWithHistory(head, earlier);
  }
}
