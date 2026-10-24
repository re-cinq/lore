import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));
vi.mock(
  "@re-cinq/lore-shared/floor/floor-client.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@re-cinq/lore-shared/floor/floor-client.js")
    >()),
    floorClient: vi.fn(),
    floorConfigured: () => true,
  }),
);

import Hapi from "@hapi/hapi";
import { buildServer } from "../../../app/build-server.js";
import { triageRoute } from "./triage.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("GET /api/repos/{owner}/{repo}/triage", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns issue 42 under current with its open issue-triage run and stages, and #43 needs-triage in the backlog", async () => {
    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => ({ fullName: "re-cinq/lore" }) },
      issues: {
        list: async () => [
          {
            number: 42,
            title: "A triage issue",
            state: "open",
            labels: ["triage: diagnosed"],
            url: "https://gh/i/42",
          },
          {
            number: 43,
            title: "Another",
            state: "open",
            labels: ["triage: needs-triage"],
            url: "https://gh/i/43",
          },
        ],
      },
    } as never);
    const asked: string[] = [];
    const server = Hapi.server();

    server.auth.scheme("stub", () => ({
      authenticate: (_r, h) => h.authenticated({ credentials: {} }),
    }));
    server.auth.strategy("bearer-scope", "stub");
    server.auth.default("bearer-scope");
    server.route(
      triageRoute(async (repo) => {
        asked.push(repo);

        return [
          {
            id: "run-42",
            issueNumber: "42",
            pipeline: [{ node_id: "verify", state: "running" }],
          },
        ];
      }),
    );

    const res = await server.inject("/api/repos/re-cinq/lore/triage");
    const body = JSON.parse(res.payload);

    expect({
      status: res.statusCode,
      asked,
      current: body.current,
      backlog: body.backlog.map(
        (r: { issue_number: number }) => r.issue_number,
      ),
    }).toEqual({
      status: 200,
      asked: ["re-cinq/lore"],
      current: [
        {
          issue_number: 42,
          issue_url: "https://gh/i/42",
          title: "A triage issue",
          state: "diagnosed",
          run_id: "run-42",
          pipeline: [{ node_id: "verify", state: "running" }],
          created_at: null,
        },
      ],
      backlog: [43],
    });
  });

  it("returns 404 without reading issues for a repo that is not onboarded", async () => {
    let reads = 0;

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => null },
      issues: {
        list: async () => {
          reads++;

          return [];
        },
      },
    } as never);

    const res = await buildServer(() => makePool() as never).inject({
      method: "GET",
      url: "/api/repos/someone/elsewhere/triage",
      headers: AUTH,
    });

    expect({ status: res.statusCode, reads }).toEqual({
      status: 404,
      reads: 0,
    });
  });
});

describe("GET /api/repos/{owner}/{repo}/triage reading only triage's issues", () => {
  afterEach(() => vi.clearAllMocks());

  it("asks GitHub for the open issues of each triage label rather than every open issue, reads #50 a run took up before any label on its own, and cuts the backlog of 3 to 2 for ?backlog=1", async () => {
    const asked: unknown[] = [];
    const issue = (number: number, labels: string[]) => ({
      number,
      title: `Issue ${number}`,
      state: "open",
      labels,
      url: `https://gh/i/${number}`,
    });

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => ({ fullName: "re-cinq/lore" }) },
      issues: {
        list: async (filter: unknown) => {
          asked.push(filter);

          return [1, 2, 3].map((n) => issue(n, ["triage: needs-triage"]));
        },
        get: async (number: number) => issue(number, []),
      },
    } as never);
    const server = Hapi.server();

    server.auth.scheme("stub", () => ({
      authenticate: (_r, h) => h.authenticated({ credentials: {} }),
    }));
    server.auth.strategy("bearer-scope", "stub");
    server.auth.default("bearer-scope");
    server.route(
      triageRoute(async () => [
        { id: "run-50", issueNumber: "50", pipeline: [] },
      ]),
    );

    const body = JSON.parse(
      (await server.inject("/api/repos/re-cinq/lore/triage?backlog=1")).payload,
    );

    expect({
      asked,
      current: body.current.map(
        (r: { issue_number: number }) => r.issue_number,
      ),
      backlog: body.backlog.map(
        (r: { issue_number: number }) => r.issue_number,
      ),
    }).toEqual({
      asked: [
        "failed",
        "needs-priority",
        "not-actionable",
        "unable-to-reproduce",
        "needs-reproduction",
        "skipped",
        "diagnosed",
        "reproduced",
        "needs-triage",
      ].map((state) => ({ state: "open", labels: [`triage: ${state}`] })),
      current: [50],
      backlog: [1, 2],
    });
  });
});
