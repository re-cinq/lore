import type { IngestDeltaDeps } from "./ingest-delta-deps.js";
import { mirrorQuietly } from "../../../work/utopia/mirror-quietly.js";

/** The part of a default-branch test-report delta the Utopia mirror reads. */
export interface ReportDelta {
  commit: string;
  report?: unknown;
  deleted?: string[];
}

/** After the graph has a default-branch test report, Utopia gets its tests at the delta's commit and loses its deleted test files (see {@link mirrorQuietly}). */
export async function mirrorReportDelta(
  deps: IngestDeltaDeps,
  repo: string,
  delta: ReportDelta,
): Promise<void> {
  const { report, commit, deleted } = delta;

  if (report !== undefined) {
    await mirrorQuietly(repo, `test report at ${commit}`, () =>
      deps.mirrorReport(repo, { report }),
    );
  }

  if (deleted?.length) {
    await mirrorQuietly(repo, deleted.join(", "), () =>
      deps.unmirrorTests(repo, deleted),
    );
  }
}
