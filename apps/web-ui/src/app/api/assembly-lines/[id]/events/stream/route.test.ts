// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyLineRun = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-line-runs", () => ({ fetchAssemblyLineRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const routeModule = await import("./route");
const { GET, dynamic } = routeModule;

const params = Promise.resolve({ id: "run-1" });

function authorized() {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyLineRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
  userCanAccessRepo.mockResolvedValue(true);
}

function sseResponse(status = 200) {
  return new Response("id: 1\nevent: agent-event\ndata: {}\n\n", { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_FLOOR_URL = "http://floor:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi.fn().mockResolvedValue(sseResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("route config", () => {
  it("exports dynamic force-dynamic and no runtime override", () => {
    expect(dynamic).toBe("force-dynamic");
    expect("runtime" in routeModule).toBe(false);
  });
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
});

describe("upstream proxying", () => {
  it("requests /api/agent-events/stream/run-1 on the Floor", async () => {
    authorized();

    await GET(new Request("http://ui/x"), { params });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "http://floor:3000/api/agent-events/stream/run-1",
    );
  });

  it("forwards the incoming Last-Event-ID header upstream", async () => {
    authorized();

    await GET(
      new Request("http://ui/x", { headers: { "Last-Event-ID": "77" } }),
      { params },
    );

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "Last-Event-ID": "77",
    });
  });

  it("omits Last-Event-ID when the browser sends none", async () => {
    authorized();

    await GET(new Request("http://ui/x"), { params });

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "Last-Event-ID",
    );
  });

  it("forwards the after query param upstream", async () => {
    authorized();

    await GET(new Request("http://ui/x?after=42"), { params });

    expect(String(fetchMock.mock.calls[0][0])).toContain("after=42");
  });

  it("passes the request signal to the upstream fetch", async () => {
    authorized();
    const req = new Request("http://ui/x");

    await GET(req, { params });

    expect(fetchMock.mock.calls[0][1].signal).toBe(req.signal);
  });

  it("returns the upstream body without reading it", async () => {
    authorized();
    const upstream = sseResponse();
    const text = vi.spyOn(upstream, "text");
    const json = vi.spyOn(upstream, "json");

    fetchMock.mockResolvedValue(upstream);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(res.body).toBe(upstream.body);
  });
});

describe("anti-buffering headers (FR4.8)", () => {
  it("returns Cache-Control no-cache, no-transform and X-Accel-Buffering no", async () => {
    authorized();

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("returns Content-Type text/event-stream", async () => {
    authorized();

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });
});

describe("upstream failures", () => {
  it("returns 503 when the Floor is at subscriber capacity", async () => {
    authorized();
    fetchMock.mockResolvedValue(sseResponse(503));

    expect((await GET(new Request("http://ui/x"), { params })).status).toBe(
      503,
    );
  });

  it("returns 404 when the Floor has no stream route", async () => {
    authorized();
    fetchMock.mockResolvedValue(sseResponse(404));

    expect((await GET(new Request("http://ui/x"), { params })).status).toBe(
      404,
    );
  });
});
