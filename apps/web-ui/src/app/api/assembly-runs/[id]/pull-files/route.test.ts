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

const params = Promise.resolve({ id: "run-1" });

function authorized(prNumber: number | null = 42) {
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyRun.mockResolvedValue({
    id: "run-1",
    repo: "re-cinq/lore",
    prNumber,
  });
  userCanAccessRepo.mockResolvedValue(true);
}

const upstreamBody = JSON.stringify({
  files: [{ filename: "src/a.ts", status: "modified" }],
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(upstreamBody, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    fetchAssemblyRun.mockResolvedValue(null);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the user cannot access the run repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "other/repo" });
    userCanAccessRepo.mockResolvedValue(false);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a run without a pull request", () => {
  it("returns 404 This run has no pull request without calling upstream", async () => {
    authorized(null);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This run has no pull request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("upstream proxying", () => {
  it("requests /api/repos/re-cinq/lore/pulls/42/files on lore-api with the bearer token", async () => {
    authorized(42);

    await GET(new Request("http://ui/x"), { params });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/pulls/42/files",
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer tok",
    });
  });

  it("passes the upstream body through as JSON", async () => {
    authorized(42);

    const res = await GET(new Request("http://ui/x"), { params });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.text()).toBe(upstreamBody);
  });
});
