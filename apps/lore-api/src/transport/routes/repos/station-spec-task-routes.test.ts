import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const calls: unknown[] = [];

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async (repo: string) => ({
    tasks: {
      reconcileSpecTasks: async (input: unknown) => {
        calls.push({ repo, input });

        return { created: 1, updated: 9, cancelled: 0 };
      },
    },
  }),
}));

import { buildServer } from "../../../app/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const put = (payload: object) =>
  buildServer(() => null).inject({
    method: "PUT",
    url: "/api/repos/re-cinq/lore/tasks/spec-tasks",
    headers: AUTH,
    payload,
  });

const T001 = {
  description: "Add the issue-triage line stub",
  taskType: "spec-task",
  issueNumber: 2261,
  issueUrl: "https://github.com/re-cinq/lore/issues/2261",
  contextBundle: { spec_task_id: "T001" },
};

describe("PUT /api/repos/{owner}/{repo}/tasks/spec-tasks", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    calls.length = 0;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reconciles plan 3b3a67af's spec-tasks in re-cinq/lore and answers what changed", async () => {
    const res = await put({ planId: "3b3a67af", groupId: "g1", tasks: [T001] });

    expect({ status: res.statusCode, body: res.result, calls }).toEqual({
      status: 200,
      body: { created: 1, updated: 9, cancelled: 0 },
      calls: [
        {
          repo: "re-cinq/lore",
          input: { planId: "3b3a67af", groupId: "g1", tasks: [T001] },
        },
      ],
    });
  });

  it("answers 400 for a spec-task with no issue number", async () => {
    const { issueNumber: _dropped, ...noIssue } = T001;
    const res = await put({ planId: "3b3a67af", tasks: [noIssue] });

    expect({ status: res.statusCode, calls }).toEqual({
      status: 400,
      calls: [],
    });
  });
});
