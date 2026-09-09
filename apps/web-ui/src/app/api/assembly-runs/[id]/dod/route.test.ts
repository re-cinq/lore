// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyRun = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-runs", () => ({ fetchAssemblyRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { GET, dynamic } = await import("./route");

const params = Promise.resolve({ id: "run-1" });

function authorized() {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
  userCanAccessRepo.mockResolvedValue(true);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ present: true, passed: 2, total: 5 }), {
      status: 200,
    }),
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

  it("returns 403 when the user cannot access the run repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "other/repo" });
    userCanAccessRepo.mockResolvedValue(false);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(403);
  });
});

describe("upstream proxying", () => {
  it("reads /api/assembly-runs/run-1/dod on lore-api and passes the body through", async () => {
    authorized();

    const res = await GET(new Request("http://ui/x"), { params });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/assembly-runs/run-1/dod",
    );
    expect(await res.json()).toEqual({ present: true, passed: 2, total: 5 });
  });
});
