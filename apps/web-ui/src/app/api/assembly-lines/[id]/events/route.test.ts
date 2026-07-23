// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyLineRun = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-line-runs", () => ({ fetchAssemblyLineRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { GET, dynamic } = await import("./route");

const params = Promise.resolve({ id: "run-1" });

function authorized() {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyLineRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
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
      new Response(JSON.stringify({ events: [] }), { status: 200 }),
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

  it("returns 404 when the run does not exist", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyLineRun.mockResolvedValue(null);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the user cannot access the run repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyLineRun.mockResolvedValue({ id: "run-1", repo: "other/repo" });
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
  it("requests /api/agent-events/run-1 on the Floor", async () => {
    authorized();

    await GET(new Request("http://ui/x"), { params });

    expect(fetchMock.mock.calls[0][0]).toContain(
      "http://floor:3000/api/agent-events/run-1",
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
      new Response(JSON.stringify({ events: [{ id: "1" }] }), { status: 207 }),
    );

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(207);
    expect(await res.json()).toEqual({ events: [{ id: "1" }] });
  });
});
