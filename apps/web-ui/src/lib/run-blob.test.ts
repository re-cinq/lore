// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyRun = vi.fn();
const userCanAccessRepo = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-runs", () => ({ fetchAssemblyRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));

const { fetchRunBlob } = await import("./run-blob");

const HASH = `sha256-${"ab12".repeat(16)}`;
const BLOB = {
  hash: HASH,
  contentType: "text/markdown",
  size: 3,
  text: "# x",
  truncated: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
  getServerSession.mockResolvedValue({ accessToken: "gho_x" });
  fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
  userCanAccessRepo.mockResolvedValue(true);
  fetchMock = vi.fn().mockResolvedValue(Response.json(BLOB));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRunBlob", () => {
  it("reads the blob through lore-api with the service token", async () => {
    expect(await fetchRunBlob("run-1", HASH)).toEqual({
      status: "ok",
      blob: BLOB,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api:3000/api/assembly-runs/run-1/blobs/${HASH}`,
      expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
    );
  });

  it("is denied, asking nothing, for a caller without access to the run's repo", async () => {
    userCanAccessRepo.mockResolvedValue(false);

    expect(await fetchRunBlob("run-1", HASH)).toEqual({ status: "denied" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is not found for a run that does not exist", async () => {
    fetchAssemblyRun.mockResolvedValue(null);

    expect(await fetchRunBlob("run-1", HASH)).toEqual({ status: "not-found" });
  });

  it("is not found when lore-api says the run does not reference the blob", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));

    expect(await fetchRunBlob("run-1", HASH)).toEqual({ status: "not-found" });
  });
});
