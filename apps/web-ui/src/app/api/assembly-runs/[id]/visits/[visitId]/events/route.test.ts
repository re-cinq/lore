// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyRun = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-runs", () => ({ fetchAssemblyRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { GET } = await import("./route");

const params = Promise.resolve({ id: "run-1", visitId: "visit-1" });
const EVENTS = { events: [{ id: "2", name: "station_run.dispatch" }] };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
  userCanAccessRepo.mockResolvedValue(true);
  fetchMock = vi.fn().mockResolvedValue(Response.json(EVENTS));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/assembly-runs/[id]/visits/[visitId]/events", () => {
  it("reads visit-1's events of run-1 on lore-api and passes the body through", async () => {
    const res = await GET(new Request("http://ui/x"), { params });

    expect({
      url: String(fetchMock.mock.calls[0][0]),
      body: await res.json(),
    }).toEqual({
      url: "http://api:3000/api/assembly-runs/run-1/visits/visit-1/events",
      body: EVENTS,
    });
  });

  it("returns 403, asking lore-api nothing, for a caller without access to the run's repo", async () => {
    userCanAccessRepo.mockResolvedValue(false);

    const res = await GET(new Request("http://ui/x"), { params });

    expect({ status: res.status, asked: fetchMock.mock.calls.length }).toEqual({
      status: 403,
      asked: 0,
    });
  });
});
