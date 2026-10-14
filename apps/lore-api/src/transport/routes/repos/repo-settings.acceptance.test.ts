import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";
import type {
  BranchRule,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

vi.mock(
  "@re-cinq/lore-shared/project/github-installations/lore-app-login.js",
  () => ({ loreAppLogin: async () => "lore-agent[bot]" }),
);

vi.mock("../../../outbound/github-client.js", () => ({
  getOctokit: vi.fn(),
  isAppConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock("../two-key.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../two-key.js")>();

  return {
    ...actual,
    checkApproval: vi.fn(async (request) =>
      request.headers["x-lore-approval-pr"]
        ? {
            ok: true,
            evidence: { prRef: "#5", approver: "gedaiu", prUrl: "url" },
          }
        : { ok: false, code: 403, body: { error: "two_key_required" } },
    ),
  };
});

const protectedRule: BranchRule = {
  requiredApprovals: 1,
  codeOwnersReview: true,
  requiredChecks: ["build"],
};

interface FakeRepo {
  rule: () => Promise<BranchRule>;
  open: PullRef[];
  disarmed: string[];
  audit: InMemoryAudit;
}

function fakeProject(repo: FakeRepo): void {
  vi.mocked(projectFor).mockResolvedValue({
    repo: { defaultBranch: async () => "main" },
    pulls: {
      getBranchRule: repo.rule,
      list: async () => repo.open,
      cancelAutoMerge: async (nodeId: string) => {
        repo.disarmed.push(nodeId);
      },
    },
    audit: repo.audit,
  } as never);
}

function onboardedPool() {
  const pool = makePool();

  pool.query
    .mockResolvedValueOnce({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    })
    .mockResolvedValue({ rows: [] });

  return pool;
}

function put(
  pool: ReturnType<typeof makePool>,
  approver: string,
  headers: Record<string, string> = {},
) {
  return buildServer(() => pool as never).inject({
    method: "PUT",
    url: "/api/repos/re-cinq/lore/settings",
    headers: { ...AUTH, ...headers },
    payload: JSON.stringify({ settings: { auto_merge: { approver } } }),
  });
}

const openPull = (number: number, author: string): PullRef => ({
  repo: "re-cinq/lore",
  number,
  title: `PR ${number}`,
  branch: `b${number}`,
  state: "open",
  labels: [],
  url: `https://github.com/re-cinq/lore/pull/${number}`,
  author,
  autoMerge: true,
  nodeId: `PR_${number}`,
});

const originalEnv = { ...process.env };

describe("PUT /api/repos/{owner}/{repo}/settings auto_merge.approver acceptance", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("refuses lore-reviewer with 403 naming the missing Code Owners review and CI checks", async () => {
    const pool = onboardedPool();

    fakeProject({
      rule: async () => ({
        ...protectedRule,
        codeOwnersReview: false,
        requiredChecks: [],
      }),
      open: [],
      disarmed: [],
      audit: new InMemoryAudit(),
    });

    const res = await put(pool, "lore-reviewer", {
      "x-lore-approval-pr": "#5",
    });

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 403,
      body: {
        error:
          "Cannot enable lore-reviewer. Missing: review from Code Owners, the required CI checks",
        code: "missing_prerequisites",
        missing: ["review from Code Owners", "the required CI checks"],
      },
    });
  });

  it("saves auto_merge.approver as lore-reviewer when prerequisites are met", async () => {
    const pool = onboardedPool();

    fakeProject({
      rule: async () => protectedRule,
      open: [],
      disarmed: [],
      audit: new InMemoryAudit(),
    });

    const res = await put(pool, "lore-reviewer", {
      "x-lore-approval-pr": "#5",
    });
    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect({ status: res.statusCode, settings: update?.[1]?.[0] }).toEqual({
      status: 200,
      settings: JSON.stringify({ auto_merge: { approver: "lore-reviewer" } }),
    });
  });

  it("disarms Lore's armed PR 7, leaves a person's PR 8 armed, and writes one auto_merge_disarmed row when setting none", async () => {
    const pool = onboardedPool();
    const repo: FakeRepo = {
      rule: async () => protectedRule,
      open: [openPull(7, "lore-agent[bot]"), openPull(8, "gedaiu")],
      disarmed: [],
      audit: new InMemoryAudit(),
    };

    fakeProject(repo);

    const res = await put(pool, "none");

    expect({
      status: res.statusCode,
      disarmed: repo.disarmed,
      audit: repo.audit.entries,
    }).toEqual({
      status: 200,
      disarmed: ["PR_7"],
      audit: [{ event_type: "auto_merge_disarmed", payload: { prNumber: 7 } }],
    });
  });
});
