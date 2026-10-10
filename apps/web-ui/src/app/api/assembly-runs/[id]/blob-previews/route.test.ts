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
const ISSUE = `sha256-${"a".repeat(64)}`;
const PLAN = `sha256-${"c".repeat(64)}`;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ previews: {} }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/assembly-runs/[id]/blob-previews", () => {
  it("asks lore-api for the issue and plan previews of run-1", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
    userCanAccessRepo.mockResolvedValue(true);

    const res = await GET(
      new Request(`http://ui/x?hash=${ISSUE}&hash=${PLAN}`),
      { params },
    );

    expect({ status: res.status, url: fetchMock.mock.calls[0]?.[0] }).toEqual({
      status: 200,
      url: `http://api:3000/api/assembly-runs/run-1/blob-previews?hash=${ISSUE}&hash=${PLAN}`,
    });
  });

  it("returns 403, asking lore-api nothing, for a caller without access to the run's repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "other/repo" });
    userCanAccessRepo.mockResolvedValue(false);

    const res = await GET(new Request(`http://ui/x?hash=${ISSUE}`), {
      params,
    });

    expect({ status: res.status, asked: fetchMock.mock.calls.length }).toEqual({
      status: 403,
      asked: 0,
    });
  });
});
