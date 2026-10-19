// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyRun = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-runs", () => ({ fetchAssemblyRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { POST } = await import("./route");

const params = Promise.resolve({ id: "old-run" });

let fetchMock: ReturnType<typeof vi.fn>;

function signedIn() {
  getServerSession.mockResolvedValue({ accessToken: "gho_x", login: "gedaiu" });
  fetchAssemblyRun.mockResolvedValue({ id: "old-run", repo: "re-cinq/lore" });
  userCanAccessRepo.mockResolvedValue(true);
}

function lore(status: number, body: object) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/assembly-runs/[id]/upgrade", () => {
  it("asks lore-api to upgrade old-run and answers 201 with the run it started", async () => {
    signedIn();
    lore(201, { run_id: "new-run" });

    const res = await POST(new Request("http://ui/x", { method: "POST" }), {
      params,
    });

    expect({
      status: res.status,
      body: await res.json(),
      url: fetchMock.mock.calls[0][0],
      method: (fetchMock.mock.calls[0][1] as RequestInit).method,
    }).toEqual({
      status: 201,
      body: { run_id: "new-run" },
      url: "http://api:3000/api/assembly-runs/old-run/upgrade",
      method: "POST",
    });
  });

  it("passes lore-api's 409 through with its reason instead of redirecting", async () => {
    signedIn();
    lore(409, { error: "this run already uses the latest assembly line" });

    const res = await POST(new Request("http://ui/x", { method: "POST" }), {
      params,
    });

    expect({
      status: res.status,
      location: res.headers.get("location"),
      body: await res.json(),
    }).toEqual({
      status: 409,
      location: null,
      body: { error: "this run already uses the latest assembly line" },
    });
  });

  it("answers 404 and asks lore-api nothing for a run the UI cannot read", async () => {
    signedIn();
    fetchAssemblyRun.mockResolvedValue(null);

    const res = await POST(new Request("http://ui/x", { method: "POST" }), {
      params,
    });

    expect({ status: res.status, asked: fetchMock.mock.calls.length }).toEqual({
      status: 404,
      asked: 0,
    });
  });

  it("answers 403 for a person without access to the run's repo", async () => {
    signedIn();
    userCanAccessRepo.mockResolvedValue(false);

    const res = await POST(new Request("http://ui/x", { method: "POST" }), {
      params,
    });

    expect(res.status).toBe(403);
  });

  it("answers 500 with the message when lore-api cannot be reached", async () => {
    signedIn();
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const res = await POST(new Request("http://ui/x", { method: "POST" }), {
      params,
    });

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 500,
      body: { error: "connect ECONNREFUSED" },
    });
  });
});
