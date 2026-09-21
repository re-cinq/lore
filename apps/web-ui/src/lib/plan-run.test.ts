// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchPlanRun } = await import("./assembly-runs");

const ROW = {
  id: "run-1",
  blueprint_name: "feature-planning",
  definition_name: "feature-planning",
  subject_key: "plan:p1",
  graph: null,
  task_id: "t1",
  repo: "re-cinq/lore",
  branch: null,
  status: "queued",
  outcome: null,
  reason: null,
  created_at: "2026-09-21T15:26:42Z",
  started_at: null,
  finished_at: null,
  args_pr_number: null,
  pr_url: null,
  task_pr_number: null,
  issue_url: null,
  issue_number: null,
  created_by: "gedaiu",
  cost_usd: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

const runsAnswer = (runs: object[]) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ runs })));

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("fetchPlanRun", () => {
  it("asks for the newest feature-planning run keyed on plan p1 of re-cinq/lore", async () => {
    runsAnswer([ROW]);
    await fetchPlanRun("re-cinq/lore", "p1");

    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.toString(),
    ).toEqual(
      "repo=re-cinq%2Flore&subject_key=plan%3Ap1&blueprint=feature-planning&limit=1",
    );
  });

  it("answers plan p1's run", async () => {
    runsAnswer([ROW]);

    expect(await fetchPlanRun("re-cinq/lore", "p1")).toMatchObject({
      id: "run-1",
      status: "queued",
    });
  });

  it("answers null for a plan no run has started for", async () => {
    runsAnswer([]);

    expect(await fetchPlanRun("re-cinq/lore", "p1")).toBeNull();
  });
});
