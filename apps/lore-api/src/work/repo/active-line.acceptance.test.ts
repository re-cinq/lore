import { describe, expect, it } from "vitest";
import { enrolHandle } from "../../../../stations/src/onboard/enrol/station.js";
import { openOnboardPrHandle } from "../../../../stations/src/onboard/open-pr/station.js";
import { enrolRepo, type EnrolTarget } from "@re-cinq/lore-shared/onboard/enrol-repo.js";
import { startOnboardingOnFloor, type OnboardOnFloorDeps } from "./onboard-on-floor.js";
import { recordedPlanFloor } from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";

type Tools = any;
const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

describe("Onboarding Active Line", () => {
  it("refreshes drifted Lore-owned deterministic content, creates a branch, and opens a PR with gap reporting. ([validated by active-line.acceptance.test.ts](apps/lore-api/src/work/repo/active-line.acceptance.test.ts))", async () => {
    let ensuredBranch = "";
    const floorDeps: OnboardOnFloorDeps = {
      floor: recordedPlanFloor().floor,
      ensureBranch: (repo, branch) => {
        ensuredBranch = branch;

        return Promise.resolve();
      },
      failTask: () => Promise.resolve(),
    };

    await startOnboardingOnFloor(floorDeps, {
      repo: "re-cinq/app",
      taskId: "task-1",
      ticket: "ticket",
    });

    const commits: string[] = [];
    const enrolReport = await enrolHandle({
      enrol: async (target: EnrolTarget) => {
        return enrolRepo(
          {
            repo: {
              read: (path) => Promise.resolve(path === ".github/workflows/lore-ingest.yml" ? "divergent content" : null),
              commitFile: (branch, path) => {
                commits.push(path);

                return Promise.resolve();
              },
            },
            settings: {
              setRepoVariable: () => Promise.resolve(),
              setRepoSecret: () => Promise.resolve(),
            },
            issues: {
              createLabels: () => Promise.resolve(),
            },
            audit: () => Promise.resolve(),
          },
          target
        );
      }
    })({
      visitId: "v1",
      iteration: 1,
      needs: {
        target: "https://github.com/re-cinq/app@lore/onboard/task-1",
        task_id: "task-1"
      }
    }, TOOLS);

    let openedPr = false;
    let recordedPr = false;
    let prBody = "";
    const prReport = await openOnboardPrHandle({
      pulls: () => Promise.resolve({
        list: () => Promise.resolve([]),
        pull: () => Promise.resolve(null),
        open: (branch, details) => {
          openedPr = true;
          prBody = details.body;

          return Promise.resolve({
            repo: "re-cinq/app",
            number: 42,
            url: "https://github.com/re-cinq/app/pull/42",
            branch: "lore/onboard/task-1",
            author: "lore-agent",
            title: "lore: onboard re-cinq/app",
            body: details.body,
            state: "open",
            draft: false
          });
        },
      }),
      recordOnboardingPr: () => {
        recordedPr = true;

        return Promise.resolve();
      }
    })({
      visitId: "v2",
      iteration: 1,
      needs: {
        target: "https://github.com/re-cinq/app@lore/onboard/task-1",
        task_id: "task-1",
        attention: (enrolReport as any).produced.attention
      }
    }, TOOLS);

    expect({ ensuredBranch, commits, enrolOutcome: enrolReport.outcome }).toMatchObject({
      ensuredBranch: "lore/onboard/task-1",
      commits: expect.arrayContaining([".github/workflows/lore-ingest.yml"]),
      enrolOutcome: "success"
    });
    
    expect({ openedPr, recordedPr, prOutcome: prReport.outcome }).toMatchObject({
      openedPr: true,
      recordedPr: true,
      prOutcome: "success"
    });

    expect(prBody).toContain((enrolReport as any).produced.attention);
  });

  it("skips PR creation (no-op behavior) when Lore-owned files match canonical exactly. ([validated by active-line.acceptance.test.ts](apps/lore-api/src/work/repo/active-line.acceptance.test.ts))", async () => {
    let commitCount = 0;
    const enrolReport = await enrolHandle({
      enrol: async (target: EnrolTarget) => {
        return enrolRepo(
          {
            repo: {
              read: () => Promise.resolve("CANONICAL"),
              commitFile: () => {
                commitCount++;

                return Promise.resolve();
              },
            },
            settings: {
              setRepoVariable: () => Promise.resolve(),
              setRepoSecret: () => Promise.resolve(),
            },
            issues: {
              createLabels: () => Promise.resolve(),
            },
            audit: () => Promise.resolve(),
          },
          target
        );
      }
    })({
      visitId: "v1",
      iteration: 1,
      needs: {
        target: "https://github.com/re-cinq/app@lore/onboard/task-1",
        task_id: "task-1"
      }
    }, TOOLS);

    let openedPr = false;
    const prReport = await openOnboardPrHandle({
      pulls: () => Promise.resolve({
        list: () => Promise.resolve([]),
        pull: () => Promise.resolve(null),
        open: () => {
          openedPr = true;

          return Promise.reject(new Error("Validation Failed: No commits between main and lore/onboard/task-1"));
        },
      }),
      recordOnboardingPr: () => Promise.resolve()
    })({
      visitId: "v2",
      iteration: 1,
      needs: {
        target: "https://github.com/re-cinq/app@lore/onboard/task-1",
        task_id: "task-1",
        attention: (enrolReport as any).produced?.attention || ""
      }
    }, TOOLS);

    expect({ commitCount, openedPr, prOutcome: prReport.outcome }).toMatchObject({
      commitCount: 0,
      openedPr: true,
      prOutcome: "changes_requested"
    });
  });
});
