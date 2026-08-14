// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
const getTask = vi.fn();
const getTaskRuns = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/api/tasks", () => ({ getTask, getTaskRuns }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { GET, dynamic } = await import("./route");

const params = Promise.resolve({ id: "task-1" });
const req = new Request("http://ui/x");

function authorized() {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  getTask.mockResolvedValue({
    status: "ok",
    data: { id: "task-1", target_repo: "re-cinq/lore" },
  });
  userCanAccessRepo.mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  getTaskRuns.mockResolvedValue({ status: "ok", data: { runs: [] } });
});

it("exports dynamic force-dynamic", () => {
  expect(dynamic).toBe("force-dynamic");
});

describe("auth ladder", () => {
  it("returns 401 without a session access token", async () => {
    getServerSession.mockResolvedValue(null);

    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(getTask).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    getTask.mockResolvedValue({
      status: "error",
      message: "not found",
      code: 404,
    });

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the user cannot access the task repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    getTask.mockResolvedValue({
      status: "ok",
      data: { id: "task-1", target_repo: "other/repo" },
    });
    userCanAccessRepo.mockResolvedValue(false);

    const res = await GET(req, { params });

    expect(res.status).toBe(403);
    expect(getTaskRuns).not.toHaveBeenCalled();
  });
});

describe("runs payload", () => {
  it("returns the task's run rows newest first", async () => {
    authorized();
    const runs = [
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

    getTaskRuns.mockResolvedValue({ status: "ok", data: { runs } });

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs });
  });

  it("asks lore-api for the runs of the requested task", async () => {
    authorized();

    await GET(req, { params });

    expect(getTaskRuns).toHaveBeenCalledWith("task-1");
  });

  it("returns an empty runs list on a pre-0025 database", async () => {
    authorized();

    const res = await GET(req, { params });

    expect(await res.json()).toEqual({ runs: [] });
  });

  it("returns 500 when the task lookup throws", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    getTask.mockRejectedValue(new Error("api down"));

    const res = await GET(req, { params });

    expect(res.status).toBe(500);
  });

  it("forwards an upstream run-list failure with its status", async () => {
    authorized();
    getTaskRuns.mockResolvedValue({
      status: "error",
      message: "database unavailable",
      code: 503,
    });

    const res = await GET(req, { params });

    expect(res.status).toBe(503);
  });
});
