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

const params = Promise.resolve({ id: "run-1", name: "review" });

let fetchMock: ReturnType<typeof vi.fn>;

function signedIn(session: object) {
  getServerSession.mockResolvedValue({ accessToken: "gho_x", ...session });
  fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
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

describe("POST /api/assembly-runs/[id]/nodes/[name]/run", () => {
  it("asks lore-api to run review of run-1 in gedaiu's name and answers 202 with the floor's answer", async () => {
    signedIn({ login: "gedaiu" });
    lore(202, { run_id: "run-1", pending: false });

    const res = await POST(new Request("http://ui/x"), { params });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect({
      status: res.status,
      body: await res.json(),
      url,
      sent: JSON.parse(String(init.body)) as unknown,
    }).toEqual({
      status: 202,
      body: { run_id: "run-1", pending: false },
      url: "http://api:3000/api/assembly-runs/run-1/nodes/review/run",
      sent: { requested_by: "gedaiu" },
    });
  });

  it("passes lore-api's 409 through with the floor's reason", async () => {
    signedIn({ login: "gedaiu" });
    lore(409, { error: "node review of run run-1 is already running" });

    const res = await POST(new Request("http://ui/x"), { params });

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 409,
      body: { error: "node review of run run-1 is already running" },
    });
  });

  it("answers 401 and asks lore-api nothing for a session with no login or name", async () => {
    signedIn({});

    const res = await POST(new Request("http://ui/x"), { params });

    expect({ status: res.status, asked: fetchMock.mock.calls.length }).toEqual({
      status: 401,
      asked: 0,
    });
  });

  it("answers 403 for a person without access to the run's repo", async () => {
    signedIn({ login: "gedaiu" });
    userCanAccessRepo.mockResolvedValue(false);

    const res = await POST(new Request("http://ui/x"), { params });

    expect(res.status).toBe(403);
  });

  it("answers 500 with the message when lore-api cannot be reached", async () => {
    signedIn({ login: "gedaiu" });
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const res = await POST(new Request("http://ui/x"), { params });

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 500,
      body: { error: "connect ECONNREFUSED" },
    });
  });
});
