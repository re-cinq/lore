import Hapi from "@hapi/hapi";
import { describe, it, expect, vi } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { PullFileChange } from "@re-cinq/lore-shared";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { registerBearerScope } from "../../http/bearer-scope.js";

const FILES: PullFileChange[] = [
  {
    filename: "src/a.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: "@@ -1 +1,2 @@\n-a\n+b\n+c",
  },
];

const listed = vi.fn();

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async (repo: string) => ({
    pulls: {
      listFileChanges: async (number: number) => {
        listed(repo, number);

        return FILES;
      },
    },
    settings: { record: async () => ({ fullName: repo }) },
  }),
}));

import { runPullFilesRoute } from "./run-pull-files.js";

async function serve(taskPrNumber: number | null) {
  const runs = new InMemoryAssemblyRuns();
  const runId = await runs.start({
    blueprintName: "implementation",
    repo: "re-cinq/lore",
    taskId: "task-1",
    args: {},
  });
  const pool = makePool();
  const server = Hapi.server();

  pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
  registerBearerScope(server, () => pool as never);
  server.route(
    runPullFilesRoute(() => pool as never, {
      runsOf: () => runs,
      reads: {
        costsByRun: async () => new Map(),
        taskJoin: async () =>
          new Map([
            [
              runId,
              {
                pr_url: null,
                task_pr_number: taskPrNumber,
                issue_url: null,
                issue_number: null,
                created_by: null,
                cost_usd: null,
              },
            ],
          ]),
      },
    }),
  );

  return server.inject({
    url: `/api/assembly-runs/${runId}/pull-files`,
    headers: { authorization: "Bearer reader" },
  });
}

describe("GET /api/assembly-runs/{id}/pull-files", () => {
  it("answers the files of pull request 4613 for run r1", async () => {
    const res = await serve(4613);

    expect({
      status: res.statusCode,
      body: res.result,
      read: listed.mock.calls,
    }).toEqual({
      status: 200,
      body: { files: FILES },
      read: [["re-cinq/lore", 4613]],
    });
  });

  it("answers 404 for a run with no pull request", async () => {
    expect((await serve(null)).statusCode).toBe(404);
  });
});
