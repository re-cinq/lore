// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { listGithubInstallations, recordGithubInstallation } =
  await import("./github-installations");

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

describe("recordGithubInstallation", () => {
  it("posts installation 81234567 to lore-api's /api/github/installations", async () => {
    await recordGithubInstallation(81234567);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect({
      url,
      method: init.method,
      body: JSON.parse(init.body as string) as unknown,
    }).toEqual({
      url: "http://api:3000/api/github/installations",
      method: "POST",
      body: { installation_id: 81234567 },
    });
  });
});
