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
    target: "https://github.com/re-cinq/app@lore/onboard/app-1234abcd",
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

  it("hands the carried onboarding credential to enrolment, and none when the run carries none", async () => {
    const credentials: Array<string | undefined> = [];
    const handle = enrolHandle({
      enrol: (_target, credential) => {
        credentials.push(credential);

        return Promise.resolve({ committed: [], attention: "" });
      },
    });
    const tools: Tools = {
      ...TOOLS,
      read: () => Promise.resolve(Buffer.from("person-token\n")),
    };

    await handle(
      { ...BRIEF, needs: { ...BRIEF.needs, credential: "blob" } },
      tools,
    );
    await handle(BRIEF, TOOLS);

    expect(credentials).toEqual(["person-token", undefined]);
  });

  it("reports failed and enrols nothing when the carried credential cannot be read", async () => {
    let enrolled = 0;
    const handle = enrolHandle({
      enrol: () => {
        enrolled += 1;

        return Promise.resolve({ committed: [], attention: "" });
      },
    });
    const tools: Tools = {
      ...TOOLS,
      read: () => Promise.reject(new Error("blob store unavailable")),
    };

    const report = await handle(
      { ...BRIEF, needs: { ...BRIEF.needs, credential: "blob" } },
      tools,
    );

    expect({ outcome: report.outcome, enrolled }).toEqual({
      outcome: "failed",
      enrolled: 0,
    });
  });

  it("reports failed and enrols nothing as the App when the run carries a blank credential", async () => {
    let enrolled = 0;
    const handle = enrolHandle({
      enrol: () => {
        enrolled += 1;

        return Promise.resolve({ committed: [], attention: "" });
      },
    });
    const tools: Tools = {
      ...TOOLS,
      read: () => Promise.resolve(Buffer.from("  \n")),
    };

    const report = await handle(
      { ...BRIEF, needs: { ...BRIEF.needs, credential: "blob" } },
      tools,
    );

    expect({ outcome: report.outcome, enrolled }).toEqual({
      outcome: "failed",
      enrolled: 0,
    });
  });
});
