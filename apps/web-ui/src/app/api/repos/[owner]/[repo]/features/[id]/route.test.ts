// @vitest-environment node
//
// The planning wizard's poll had NO authorization: no session check, no
// repo-access check. Any signed-in user could poll any repo's feature and read
// its original prompt, every round's gap analysis, and the draft spec — for a repo
// they cannot see on GitHub. Its sibling
// (api/assembly-lines/[id]/nodes/[name]/logs) always gated both.
//
// The gate runs BEFORE the feature is looked up, so a 404 cannot be used to probe
// which feature ids exist in a repo the caller has no access to.

import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
const userCanAccessRepo = vi.fn();
const queryAllowMissing = vi.fn();
const fetchFeatureRun = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));
vi.mock("@/lib/db", () => ({ queryAllowMissing }));
vi.mock("@/lib/feature-run", () => ({
  fetchFeatureRun,
  runTaskIdFor: () => null,
}));
vi.mock("@/lib/station-conversation", () => ({
  formatStationConversation: () => null,
}));

const { GET } = await import("./route");

const params = Promise.resolve({
  owner: "re-cinq",
  repo: "lore",
  id: "feat-1",
});

const req = new Request("http://localhost/api/repos/re-cinq/lore/features/x");

beforeEach(() => {
  vi.clearAllMocks();
  queryAllowMissing.mockResolvedValue([]);
  fetchFeatureRun.mockResolvedValue(null);
});

describe("GET feature poll authorization", () => {
  it("rejects a caller with no session", async () => {
    getServerSession.mockResolvedValue(null);

    expect((await GET(req, { params })).status).toBe(401);
  });

  it("rejects a session carrying no access token", async () => {
    getServerSession.mockResolvedValue({});

    expect((await GET(req, { params })).status).toBe(401);
  });

  it("rejects a caller who cannot see the repo", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    userCanAccessRepo.mockResolvedValue(false);

    expect((await GET(req, { params })).status).toBe(403);
  });

  it("reads nothing at all for an unauthorized caller", async () => {
    // The gate runs BEFORE the lookup: a 404 must not tell an outsider whether a
    // feature id exists in a repo they cannot see.
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    userCanAccessRepo.mockResolvedValue(false);

    await GET(req, { params });

    expect(queryAllowMissing).not.toHaveBeenCalled();
  });

  it("checks access against the repo named in the path", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    userCanAccessRepo.mockResolvedValue(true);

    await GET(req, { params });

    expect(userCanAccessRepo).toHaveBeenCalledWith("gho_x", "re-cinq/lore");
  });

  it("proceeds to the feature lookup for an authorized caller", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    userCanAccessRepo.mockResolvedValue(true);

    expect((await GET(req, { params })).status).toBe(404);
    expect(queryAllowMissing).toHaveBeenCalled();
  });
});
