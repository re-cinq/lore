import { describe, expect, it } from "vitest";
import { planRun } from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import {
  loopProgressHandlers,
  type LoopProgressDeps,
} from "./loop-progress-handlers.js";

const SHA = "abc123def456";
const REPO = "acme/widgets";

const loopRun = planRun({
  id: "run-1",
  lineId: "implementation-loop",
  repo: `github.com/${REPO}`,
  startItems: {
    repo: {
      kind: "git",
      ref: `github.com/${REPO}@lore/implementation-loop/issue-7`,
      by: "lore",
    },
    pr_check_sha: { kind: "value", ref: SHA, by: "lore" },
  },
});

function scene(overrides: Partial<LoopProgressDeps> = {}): {
  checks: CheckRunInput[];
  deps: LoopProgressDeps;
} {
  const checks: CheckRunInput[] = [];

  return {
    checks,
    deps: {
      run: async () => loopRun,
      upsertCheckRun: async (_repo, input) => {
        checks.push(input);
      },
      ...overrides,
    },
  };
}

describe("loop progress handlers", () => {
  it("publishes an in-progress check on the pr_check_sha when a station run is dispatched for the implementation loop", async () => {
    const { checks, deps } = scene();
    const handler = loopProgressHandlers(deps).get("station_run.dispatched")!;

    await handler({
      run_id: "run-1",
      line_id: "implementation-loop",
      node_id: "tdd-round",
    });

    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      headSha: SHA,
      name: "lore/implementation-loop",
      status: "in_progress",
    });
  });

  it("skips a dispatched station run that belongs to a different line", async () => {
    const { checks, deps } = scene();
    const handler = loopProgressHandlers(deps).get("station_run.dispatched")!;

    await handler({
      run_id: "run-1",
      line_id: "code-review",
      node_id: "post-review",
    });

    expect(checks).toHaveLength(0);
  });

  it("publishes a success check when an implementation-loop run settles", async () => {
    const { checks, deps } = scene();
    const handler = loopProgressHandlers(deps).get("run.settled")!;

    await handler({
      run_id: "run-1",
      line_id: "implementation-loop",
      outcome: "success",
    });

    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      headSha: SHA,
      name: "lore/implementation-loop",
      status: "completed",
      conclusion: "success",
    });
  });
});
