import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { PgTestReports } from "@re-cinq/lore-shared/project/test-reports/test-reports-pg.js";

export function issueTestReport(repo: string, commit: string) {
  return new PgTestReports(getPool()).forCommitWithHistory(repo, commit);
}
