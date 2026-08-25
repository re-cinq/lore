import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../platform/project-boot.js", () => ({ projectFor: vi.fn() }));

import { buildServer } from "../../../server/build-server.js";
import { projectFor } from "../../../platform/project-boot.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const openIssue = (number: number, labels: string[], created: string) => ({
  repo: "re-cinq/lore",
  number,
  title: `Ticket ${number}`,
  state: "open",
  labels,
  url: `https://gh/i/${number}`,
  createdAt: created,
});

describe("/api/repos/{owner}/{repo}/implementation-loop", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/implementation-loop",
      headers: AUTH,
    });
  }

  function put(payload: unknown, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "PUT",
      url: "/api/repos/re-cinq/lore/implementation-loop",
      headers: AUTH,
      payload: JSON.stringify(payload),
    });
  }

  it("returns 503 when the pool is null", async () => {
    expect((await get(null)).statusCode).toBe(503);
    expect((await put({ enabled: true }, null)).statusCode).toBe(503);
  });

  it("returns 404 for a repo with no row", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });

    expect((await get(pool)).statusCode).toBe(404);
  });

  it("returns the toggle, current ticket, ordered queue, and recent tickets", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            status: "running",
            description: "Ticket 7",
            issue_number: 7,
            issue_url: "https://gh/i/7",
            pr_url: "https://gh/pr/70",
          },
          {
            status: "completed",
            description: "Ticket 5",
            issue_number: 5,
            issue_url: "https://gh/i/5",
            pr_url: "https://gh/pr/50",
          },
        ],
      });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(7, ["priority:high"], "2026-08-01T00:00:00Z"),
          openIssue(9, ["priority:low"], "2026-08-02T00:00:00Z"),
          openIssue(8, ["priority:medium"], "2026-08-03T00:00:00Z"),
          openIssue(6, ["bug"], "2026-08-04T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      enabled: true,
      current: {
        issue_number: 7,
        issue_url: "https://gh/i/7",
        title: "Ticket 7",
        priority: "priority:high",
        pr_url: "https://gh/pr/70",
        state: "running",
      },
      next: [
        {
          issue_number: 8,
          issue_url: "https://gh/i/8",
          title: "Ticket 8",
          priority: "priority:medium",
          pr_url: null,
          state: "queued",
        },
        {
          issue_number: 9,
          issue_url: "https://gh/i/9",
          title: "Ticket 9",
          priority: "priority:low",
          pr_url: null,
          state: "queued",
        },
      ],
      recent: [
        {
          issue_number: 5,
          issue_url: "https://gh/i/5",
          title: "Ticket 5",
          priority: null,
          pr_url: "https://gh/pr/50",
          state: "completed",
        },
      ],
    });
  });

  it("still renders the queue when the loop is disabled", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ settings: {} }] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(3, ["priority:low"], "2026-08-01T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload)).toMatchObject({
      enabled: false,
      current: null,
      next: [{ issue_number: 3 }],
      recent: [],
    });
  });

  it("excludes the current ticket's issue from the queue", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            status: "running",
            description: "Ticket 7",
            issue_number: 7,
            issue_url: "https://gh/i/7",
            pr_url: null,
          },
        ],
      });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(7, ["priority:high"], "2026-08-01T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload)).toMatchObject({
      current: { issue_number: 7 },
      next: [],
    });
  });

  it("keeps an addressed-but-unmerged ticket out of the queue", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            status: "completed",
            description: "Ticket 5",
            issue_number: 5,
            issue_url: "https://gh/i/5",
            pr_url: "https://gh/pr/50",
          },
        ],
      });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(5, ["priority:high"], "2026-08-01T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload)).toMatchObject({
      current: null,
      next: [],
      recent: [{ issue_number: 5, pr_url: "https://gh/pr/50" }],
    });
  });

  it("PUT flips the toggle under admin scope and echoes the new state", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({
      issues: { createLabels: async () => {} },
    } as never);

    const res = await put({ enabled: true }, pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enabled: true });
    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect(String(update?.[0])).toContain("implementation_loop");
  });

  it("enabling seeds the priority and lore:blocked labels on the repo", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValue({ rows: [] });
    const seeded: Array<{ name: string }> = [];

    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        createLabels: async (labels: Array<{ name: string }>) => {
          seeded.push(...labels);
        },
      },
    } as never);

    const res = await put({ enabled: true }, pool);

    expect(res.statusCode).toBe(200);
    expect(seeded.map((l) => l.name)).toEqual([
      "priority:high",
      "priority:medium",
      "priority:low",
      "lore:blocked",
    ]);
  });

  it("disabling seeds nothing", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValue({ rows: [] });

    const res = await put({ enabled: false }, pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enabled: false });
    expect(projectFor).not.toHaveBeenCalled();
  });

  it("a label-seeding failure does not fail the toggle write", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockRejectedValue(new Error("github down"));

    const res = await put({ enabled: true }, pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enabled: true });
  });

  it("PUT rejects a payload without a boolean enabled", async () => {
    expect((await put({ enabled: "yes" })).statusCode).toBe(400);
  });
});
