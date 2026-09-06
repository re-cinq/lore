import { describe, it, expect, afterEach, vi } from "vitest";
import {
  deriveComputedStatus,
  fetchPrStatus,
  type PrCheck,
  type PrReview,
} from "./github-client.js";

const originalToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  process.env.GITHUB_TOKEN = originalToken;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const approved: PrReview = {
  user: "alice",
  state: "APPROVED",
  submitted_at: "",
};
const check = (conclusion: string | null, status = "completed"): PrCheck => ({
  name: "ci",
  status,
  conclusion,
});

describe("deriveComputedStatus", () => {
  it("is 'open', not 'approved', when a check is still running despite an approval", () => {
    expect(
      deriveComputedStatus({}, [check(null, "in_progress")], [approved]),
    ).toBe("open");
  });

  it("is 'approved' when every check has concluded success/skipped and there is an approval", () => {
    expect(
      deriveComputedStatus(
        {},
        [check("success"), check("skipped")],
        [approved],
      ),
    ).toBe("approved");
  });

  it("is 'approved' with an approval and no checks configured", () => {
    expect(deriveComputedStatus({}, [], [approved])).toBe("approved");
  });

  it("is 'checks-failing' when any check failed, regardless of approval", () => {
    expect(deriveComputedStatus({}, [check("failure")], [approved])).toBe(
      "checks-failing",
    );
  });

  it("is 'changes-requested' over 'approved' when both are present", () => {
    const changes: PrReview = {
      user: "bob",
      state: "CHANGES_REQUESTED",
      submitted_at: "",
    };

    expect(
      deriveComputedStatus({}, [check("success")], [approved, changes]),
    ).toBe("changes-requested");
  });

  it("prefers merged / closed / draft in that order", () => {
    expect(
      deriveComputedStatus({ merged: true, state: "closed" }, [], []),
    ).toBe("merged");
    expect(deriveComputedStatus({ state: "closed" }, [], [])).toBe("closed");
    expect(deriveComputedStatus({ draft: true }, [], [])).toBe("draft");
  });
});

const prBody = {
  number: 5,
  title: "Fix thing",
  state: "open",
  draft: false,
  merged: false,
  mergeable: true,
  html_url: "https://github.com/o/r/pull/5",
  head: { sha: "abc123" },
};
const reviewBody = [
  { user: { login: "alice" }, state: "APPROVED", submitted_at: "t1" },
];
const checkRunsBody = {
  check_runs: [{ name: "ci", status: "completed", conclusion: "success" }],
};
const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => body,
});
const fetchByPath = (
  handlers: Record<string, () => { ok: boolean; status: number }>,
) =>
  vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const [, respond] =
      Object.entries(handlers).find(([suffix]) => path.endsWith(suffix)) ?? [];

    return (respond ?? (() => ({ ok: false, status: 404 })))();
  });

describe("fetchPrStatus", () => {
  it("returns null when no GitHub token is configured", async () => {
    delete process.env.GITHUB_TOKEN;
    expect(await fetchPrStatus("o/r", 5)).toBeNull();
  });

  it("returns the PR with checks, reviews, and computed_status", async () => {
    process.env.GITHUB_TOKEN = "t0k3n";
    vi.stubGlobal(
      "fetch",
      fetchByPath({
        "/pulls/5": () => jsonResponse(prBody),
        "/pulls/5/reviews": () => jsonResponse(reviewBody),
        "/check-runs": () => jsonResponse(checkRunsBody),
      }),
    );

    expect(await fetchPrStatus("o/r", 5)).toEqual({
      number: 5,
      title: "Fix thing",
      state: "open",
      draft: false,
      merged: false,
      mergeable: true,
      html_url: "https://github.com/o/r/pull/5",
      checks: [{ name: "ci", status: "completed", conclusion: "success" }],
      reviews: [{ user: "alice", state: "APPROVED", submitted_at: "t1" }],
      computed_status: "approved",
    });
  });

  it("falls back to an empty review list when the reviews request fails", async () => {
    process.env.GITHUB_TOKEN = "t0k3n";
    vi.stubGlobal(
      "fetch",
      fetchByPath({
        "/pulls/5": () => jsonResponse(prBody),
        "/pulls/5/reviews": () => ({ ok: false, status: 500 }),
        "/check-runs": () => jsonResponse(checkRunsBody),
      }),
    );

    expect((await fetchPrStatus("o/r", 5))?.reviews).toEqual([]);
  });

  it("falls back to an empty check list when the check-runs request fails", async () => {
    process.env.GITHUB_TOKEN = "t0k3n";
    vi.stubGlobal(
      "fetch",
      fetchByPath({
        "/pulls/5": () => jsonResponse(prBody),
        "/pulls/5/reviews": () => jsonResponse(reviewBody),
        "/check-runs": () => ({ ok: false, status: 500 }),
      }),
    );

    expect((await fetchPrStatus("o/r", 5))?.checks).toEqual([]);
  });

  it("throws when the PR request itself fails", async () => {
    process.env.GITHUB_TOKEN = "t0k3n";
    vi.stubGlobal(
      "fetch",
      fetchByPath({
        "/pulls/5": () => ({ ok: false, status: 404 }),
        "/pulls/5/reviews": () => jsonResponse(reviewBody),
        "/check-runs": () => jsonResponse(checkRunsBody),
      }),
    );

    await expect(fetchPrStatus("o/r", 5)).rejects.toThrow(
      "GitHub API /repos/o/r/pulls/5: 404 undefined",
    );
  });
});
