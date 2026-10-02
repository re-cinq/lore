import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { EnrolTarget } from "@re-cinq/lore-shared/onboard/enrol-repo.js";
import { enrolHandle } from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const BRIEF = {
  visitId: "visit-enrol",
  iteration: 1,
  needs: {
    target: "github.com/re-cinq/app@lore/onboard/app-1234abcd",
    task_id: "task-1",
  },
};

describe("the onboard-enrol station", () => {
  it("enrols re-cinq/app on the branch the run was started on, for task task-1", async () => {
    const enrolled: EnrolTarget[] = [];
    const handle = enrolHandle({
      enrol: (target) => {
        enrolled.push(target);

        return Promise.resolve({ committed: [], attention: "" });
      },
    });

    await handle(BRIEF, TOOLS);

    expect(enrolled).toEqual([
      {
        repo: "re-cinq/app",
        branch: "lore/onboard/app-1234abcd",
        taskId: "task-1",
      },
    ]);
  });

  it("produces the needs-attention section so the pull request can carry it", async () => {
    const handle = enrolHandle({
      enrol: () =>
        Promise.resolve({
          committed: [],
          attention: "## Needs attention\n\n- the secret could not be set",
        }),
    });

    expect(await handle(BRIEF, TOOLS)).toEqual({
      outcome: "success",
      produced: {
        attention: "## Needs attention\n\n- the secret could not be set",
      },
    });
  });

  it("reports failed with the error when enrolment throws", async () => {
    const handle = enrolHandle({
      enrol: () => Promise.reject(new Error("GitHub App not installed")),
    });

    expect(await handle(BRIEF, TOOLS)).toEqual({
      outcome: "failed",
      error: "GitHub App not installed",
    });
  });
});
