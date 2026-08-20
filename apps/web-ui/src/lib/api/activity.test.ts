// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getMemoryAudit,
  getRepoEvents,
  getJobRun,
  getRepoActivityCounts,
  getSpend,
  getAnalyticsOverview,
} = await import("./activity");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

const url = () => String(fetchMock.mock.calls[0][0]);

describe("getMemoryAudit", () => {
  it("defaults to the first page of 50 with no filters", async () => {
    await getMemoryAudit({});

    expect(url()).toEqual("http://api:3000/api/memory-audit?limit=50&offset=0");
  });

  it("carries the agent and operation filters", async () => {
    await getMemoryAudit({ agent: "klaus", operation: "search" });

    expect(url()).toContain("agent=klaus");
    expect(url()).toContain("operation=search");
  });

  it("ignores a blank filter rather than sending an empty one", async () => {
    await getMemoryAudit({ agent: "   ", operation: "" });

    expect(url()).not.toContain("agent=");
    expect(url()).not.toContain("operation=");
  });

  it("asks for zero-result searches only when the gap view wants them", async () => {
    await getMemoryAudit({ zeroResults: true });

    expect(url()).toContain("zero_results=true");
  });
});

describe("getRepoEvents", () => {
  it("carries the repo, limit and offset", async () => {
    await getRepoEvents("re-cinq/lore", 101, 200);

    expect(url()).toContain("repo=re-cinq%2Flore");
    expect(url()).toContain("limit=101");
    expect(url()).toContain("offset=200");
  });

  it("reads from the start when no offset is given", async () => {
    await getRepoEvents("re-cinq/lore", 10);

    expect(url()).toContain("offset=0");
  });
});

describe("getJobRun", () => {
  it("encodes the run id", async () => {
    await getJobRun("run/1");

    expect(url()).toEqual("http://api:3000/api/job-runs/run%2F1");
  });
});

describe("getRepoActivityCounts", () => {
  it("reads the repo's counters", async () => {
    await getRepoActivityCounts("re-cinq/lore");

    expect(url()).toEqual(
      "http://api:3000/api/repos/re-cinq/lore/activity-counts",
    );
  });

  it("returns the counters on 200, a null figure included", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ tasks: 12, auto_merged: null, escalations: 0 }),
      ),
    );

    expect(await getRepoActivityCounts("re-cinq/lore")).toEqual({
      status: "ok",
      data: { tasks: 12, auto_merged: null, escalations: 0 },
    });
  });
});

describe("getSpend", () => {
  it("reads the whole spend screen in one call", async () => {
    await getSpend();

    expect(url()).toEqual("http://api:3000/api/spend");
  });

  it("carries the org-unavailable flag through", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ org_available: false, lore_unbilled_usd: 4 }),
      ),
    );

    expect(await getSpend()).toMatchObject({
      status: "ok",
      data: { org_available: false, lore_unbilled_usd: 4 },
    });
  });
});

describe("getAnalyticsOverview", () => {
  it("reads the analytics screen in one call", async () => {
    await getAnalyticsOverview();

    expect(url()).toEqual("http://api:3000/api/analytics-overview");
  });

  it("passes a null task summary through rather than inventing zeroes", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ task_summary: null, job_runs: [] })),
    );

    expect(await getAnalyticsOverview()).toMatchObject({
      status: "ok",
      data: { task_summary: null },
    });
  });
});
