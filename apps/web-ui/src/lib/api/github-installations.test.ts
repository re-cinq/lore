// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { listGithubInstallations } = await import("./github-installations");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("listGithubInstallations", () => {
  it("reads the connected accounts from lore-api's /api/github/installations", async () => {
    await listGithubInstallations();

    expect(fetchMock.mock.calls[0][0]).toEqual(
      "http://api:3000/api/github/installations",
    );
  });
});
