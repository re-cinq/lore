// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
const userCanAccessRepo = vi.fn();
const getFeatureStatus = vi.fn();
const fetchFeatureRunById = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));
vi.mock("@/lib/api/features", () => ({ getFeatureStatus }));
vi.mock("@/lib/api/tasks", () => ({ getTask: vi.fn() }));
vi.mock("@/lib/feature-run", () => ({
  fetchFeatureRunById,
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
  getFeatureStatus.mockResolvedValue({ status: "error", message: "not found" });
  fetchFeatureRunById.mockResolvedValue(null);
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

  it("reads nothing at all for an unauthorized caller, before the 404-probe lookup", async () => {
    getServerSession.mockResolvedValue({ accessToken: "gho_x" });
    userCanAccessRepo.mockResolvedValue(false);

    await GET(req, { params });

    expect(getFeatureStatus).not.toHaveBeenCalled();
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
    expect(getFeatureStatus).toHaveBeenCalled();
  });
});
