import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appAuth = vi.hoisted(() => ({
  create: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: (options: unknown) => {
    appAuth.create(options);

    return appAuth.auth;
  },
}));

async function clientWithApp() {
  vi.resetModules();
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "2");

  return import("./github-client.js");
}

beforeEach(() => {
  appAuth.auth.mockResolvedValue({ token: "installation-token" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getGitHubToken with a GitHub App", () => {
  it("builds one App auth for two token reads", async () => {
    const { getGitHubToken } = await clientWithApp();

    expect(await getGitHubToken()).toBe("installation-token");
    expect(await getGitHubToken()).toBe("installation-token");
    expect(appAuth.create).toHaveBeenCalledTimes(1);
  });

  it("answers GITHUB_TOKEN when the App auth fails, and asks the App again next time", async () => {
    const { getGitHubToken } = await clientWithApp();

    vi.stubEnv("GITHUB_TOKEN", "personal-token");
    appAuth.auth.mockRejectedValueOnce(new Error("GitHub is down"));

    expect(await getGitHubToken()).toBe("personal-token");
    expect(await getGitHubToken()).toBe("installation-token");
  });
});
