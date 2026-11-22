// The gate between a round that says an acceptance test is wrong and the definition of done (specs/external-floor FR12.25): the report goes back to dod only when the branch holds the named test and the round's newest commit did not change the reported file; anything else is a failed round, as a round that stopped was before.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import {
  parseTestWrongReport,
  testWrongVerdict,
} from "@re-cinq/lore-shared/backlog/acceptance-test-report.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface TestWrongCheckDeps {
  /** The file at the branch head, or null when the branch has none. */
  read(repo: string, path: string, branch: string): Promise<string | null>;
  /** The files the branch's newest commit touched. */
  newestCommitFiles(repo: string, branch: string): Promise<string[]>;
}

const productionDeps: TestWrongCheckDeps = {
  read: async (repo, path, branch) =>
    (await projectFor(repo)).repo.read(path, branch),
  newestCommitFiles: async (repo, branch) => {
    const history = await (
      await projectFor(repo)
    ).repo.branchHistory(branch, { limit: 1 });

    return history.at(0)?.files ?? [];
  },
};

export function testWrongCheckHandle(deps: TestWrongCheckDeps): Handle {
  return async ({ needs }, tools) => {
    const { repo, branch } = parseGitRef(needs.target);
    const report = parseTestWrongReport(needs.tdd_test_wrong);
    const [source, roundFiles] = report
      ? await Promise.all([
          deps.read(repo, report.file, branch),
          deps.newestCommitFiles(repo, branch),
        ])
      : [null, []];
    const verdict = testWrongVerdict(report, { source, roundFiles });

    if (!verdict.accepted) {
      console.warn(`[loop-test-wrong-check] ${repo}: ${verdict.reason}`);

      return { outcome: "failed" };
    }
    await tools.produce("dod_feedback", Buffer.from(verdict.feedback, "utf8"));

    return { outcome: "success" };
  };
}

export function startTestWrongCheckStation(): RunningStation {
  return defineStation(
    "loop-test-wrong-check",
    testWrongCheckHandle(productionDeps),
  );
}
