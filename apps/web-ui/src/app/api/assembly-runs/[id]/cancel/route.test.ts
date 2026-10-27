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

const params = Promise.resolve({ id: "plan-run" });

let fetchMock: ReturnType<typeof vi.fn>;

function signedIn(session: object) {
  getServerSession.mockResolvedValue({ accessToken: "gho_x", ...session });
  fetchAssemblyRun.mockResolvedValue({ id: "plan-run", repo: "re-cinq/Otto" });
  userCanAccessRepo.mockResolvedValue(true);
}

function lore(status: number, body: object) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function cancel() {
  return POST(new Request("http://ui/x", { method: "POST" }), { params });
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

describe("POST /api/assembly-runs/[id]/cancel", () => {
  it("asks lore-api to cancel plan-run in gedaiu's name and answers 200 with what it said", async () => {
    signedIn({ login: "gedaiu" });
    lore(200, { cancelled: true, run_id: "plan-run" });

    const res = await cancel();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect({
      status: res.status,
      body: await res.json(),
      url,
      method: init.method,
      sent: JSON.parse(String(init.body)) as unknown,
    }).toEqual({
      status: 200,
      body: { cancelled: true, run_id: "plan-run" },
      url: "http://api:3000/api/assembly-runs/plan-run/cancel",
      method: "POST",
      sent: { requested_by: "gedaiu" },
    });
  });

  it("passes lore-api's 409 through with its reason", async () => {
    signedIn({ login: "gedaiu" });
    lore(409, { error: "run plan-run already finished" });

    const res = await cancel();

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 409,
      body: { error: "run plan-run already finished" },
    });
  });

  it("answers 401 and asks lore-api nothing for a session with no login or name", async () => {
    signedIn({});

    const res = await cancel();

    expect({ status: res.status, asked: fetchMock.mock.calls.length }).toEqual({
      status: 401,
      asked: 0,
    });
  });

  it("answers 404 and asks lore-api nothing for a run the UI cannot read", async () => {
    signedIn({ login: "gedaiu" });
    fetchAssemblyRun.mockResolvedValue(null);

    const res = await cancel();

    expect({ status: res.status, asked: fetchMock.mock.calls.length }).toEqual({
      status: 404,
      asked: 0,
    });
  });

  it("answers 403 and asks lore-api nothing for a person without access to the run's repo", async () => {
    signedIn({ login: "gedaiu" });
    userCanAccessRepo.mockResolvedValue(false);

    const res = await cancel();

    expect({ status: res.status, asked: fetchMock.mock.calls.length }).toEqual({
      status: 403,
      asked: 0,
    });
  });

  it("answers 500 with the message when lore-api cannot be reached", async () => {
    signedIn({ login: "gedaiu" });
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const res = await cancel();

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 500,
      body: { error: "connect ECONNREFUSED" },
    });
  });
});
