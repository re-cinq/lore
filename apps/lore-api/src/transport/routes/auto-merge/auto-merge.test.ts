import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));
vi.mock(
  "@re-cinq/lore-shared/project/github-installations/lore-app-login.js",
  () => ({ loreAppLogin: async () => "lore[bot]" }),
);

import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("GET /api/repos/{owner}/{repo}/auto-merge", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(pool: unknown) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/auto-merge",
      headers: AUTH,
    });
  }

  it("parks Lore's #7 on its stored code-owner block and lists Lore's merged #6 under recent", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [
        {
          pr_number: "7",
          reason: "needs_code_owner",
          detail: null,
          since: new Date("2026-10-23T08:00:00Z"),
        },
      ],
    });
    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => ({ fullName: "re-cinq/lore" }) },
      pulls: {
        list: async () => [
          {
            number: 7,
            title: "Fix",
            url: "https://gh/pr/7",
            state: "open",
            author: "lore[bot]",
            autoMerge: true,
          },
        ],
        listMergedSince: async () => [
          {
            number: 6,
            title: "Done",
            url: "https://gh/pr/6",
            state: "merged",
            author: "lore[bot]",
            mergedAt: "2026-10-22T10:00:00Z",
          },
        ],
      },
    } as never);

    const res = await get(pool);
    const body = JSON.parse(res.payload);

    expect({
      status: res.statusCode,
      parked: body.parked.map((r: { pr_number: number; blocked: string }) => [
        r.pr_number,
        r.blocked,
      ]),
      recent: body.recent.map((r: { pr_number: number }) => r.pr_number),
    }).toEqual({
      status: 200,
      parked: [[7, "Needs a code owner's approval"]],
      recent: [6],
    });
  });

  it("answers 404 for a repo that is not onboarded without reading pull requests", async () => {
    const list = vi.fn();

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => null },
      pulls: { list, listMergedSince: list },
    } as never);

    const res = await get(makePool());

    expect({ status: res.statusCode, read: list.mock.calls.length }).toEqual({
      status: 404,
      read: 0,
    });
  });
});
