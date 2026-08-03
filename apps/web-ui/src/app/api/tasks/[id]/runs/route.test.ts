// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
const queryOne = vi.fn();
const queryAllowMissing = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ queryOne, queryAllowMissing }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { GET, dynamic } = await import("./route");

const params = Promise.resolve({ id: "task-1" });
const req = new Request("http://ui/x");

function authorized() {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  queryOne.mockResolvedValue({ id: "task-1", target_repo: "re-cinq/lore" });
  userCanAccessRepo.mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryAllowMissing.mockResolvedValue([]);
});

it("exports dynamic force-dynamic", () => {
  expect(dynamic).toBe("force-dynamic");
});

describe("auth ladder", () => {
  it("returns 401 without a session access token", async () => {
    getServerSession.mockResolvedValue(null);

    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    queryOne.mockResolvedValue(null);

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the user cannot access the task repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    queryOne.mockResolvedValue({ id: "task-1", target_repo: "other/repo" });
    userCanAccessRepo.mockResolvedValue(false);

    const res = await GET(req, { params });

    expect(res.status).toBe(403);
    expect(queryAllowMissing).not.toHaveBeenCalled();
  });
});

describe("runs payload", () => {
  it("returns the task's run rows newest first", async () => {
    authorized();
    const rows = [
      {
        id: "run-2",
        status: "running",
        outcome: null,
        created_at: "2026-08-02T10:00:00Z",
      },
      {
        id: "run-1",
        status: "failed",
        outcome: "validate-failed",
        created_at: "2026-08-01T10:00:00Z",
      },
    ];

    queryAllowMissing.mockResolvedValue(rows);

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: rows });
  });

  it("queries pipeline.assembly_lines by the task id", async () => {
    authorized();

    await GET(req, { params });

    expect(queryAllowMissing).toHaveBeenCalledWith(
      expect.stringContaining("FROM pipeline.assembly_lines"),
      ["task-1"],
    );
  });

  it("returns an empty runs list on a pre-0025 database", async () => {
    authorized();

    const res = await GET(req, { params });

    expect(await res.json()).toEqual({ runs: [] });
  });

  it("returns 500 when the task lookup throws", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    queryOne.mockRejectedValue(new Error("db down"));

    const res = await GET(req, { params });

    expect(res.status).toBe(500);
  });
});
