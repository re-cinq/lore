// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const getTask = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/api/tasks", () => ({ getTask }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { GET, dynamic } = await import("./route");

const params = Promise.resolve({ id: "task-1" });

function authorized(status = "running") {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  getTask.mockResolvedValue({
    status: "ok",
    data: { id: "task-1", target_repo: "re-cinq/lore", status },
  });
  userCanAccessRepo.mockResolvedValue(true);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_FLOOR_URL = "http://floor:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ turns: [] }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("exports dynamic force-dynamic", () => {
  expect(dynamic).toBe("force-dynamic");
});

describe("auth ladder", () => {
  it("returns 401 without a session access token", async () => {
    getServerSession.mockResolvedValue(null);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the upstream code when the task lookup fails", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    getTask.mockResolvedValue({
      status: "error",
      code: 404,
      message: "task not found",
    });

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user cannot access the task repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    getTask.mockResolvedValue({
      status: "ok",
      data: { id: "task-1", target_repo: "other/repo", status: "running" },
    });
    userCanAccessRepo.mockResolvedValue(false);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 500 when LORE_FLOOR_URL is unset", async () => {
    authorized();
    delete process.env.LORE_FLOOR_URL;

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(500);
  });
});

describe("upstream proxying", () => {
  it("requests the Floor's task-keyed turn route", async () => {
    authorized();

    await GET(new Request("http://ui/x"), { params });

    expect(fetchMock.mock.calls[0][0]).toContain(
      "http://floor:3000/api/agent-turns/task/task-1",
    );
  });

  it("sends the ingest token as a bearer header", async () => {
    authorized();

    await GET(new Request("http://ui/x"), { params });

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer tok",
    });
  });

  it("forwards after and limit to the Floor", async () => {
    authorized();

    await GET(new Request("http://ui/x?after=42&limit=10"), { params });

    const url = String(fetchMock.mock.calls[0][0]);

    expect(url).toContain("after=42");
    expect(url).toContain("limit=10");
  });

  it("omits after and limit when the caller sends neither", async () => {
    authorized();

    await GET(new Request("http://ui/x"), { params });

    expect(String(fetchMock.mock.calls[0][0])).not.toContain("?");
  });

  it("passes the request signal to the upstream fetch", async () => {
    authorized();
    const req = new Request("http://ui/x");

    await GET(req, { params });

    expect(fetchMock.mock.calls[0][1].signal).toBe(req.signal);
  });

  it("returns the Floor status and body verbatim", async () => {
    authorized();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ turns: [{ id: "1" }] }), { status: 207 }),
    );

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(207);
    expect(await res.json()).toEqual({ turns: [{ id: "1" }] });
  });

  it("carries the task status in the X-Task-Status header", async () => {
    authorized("pr-created");

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.headers.get("X-Task-Status")).toBe("pr-created");
  });

  it("surfaces a Floor 401 as 502 so it cannot masquerade as the proxy's own auth ladder", async () => {
    authorized();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "bad token" }), { status: 401 }),
    );

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(502);
    expect(res.headers.get("X-Task-Status")).toBe("running");
  });

  it("surfaces a Floor 403 as 502", async () => {
    authorized();
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(502);
  });
});
