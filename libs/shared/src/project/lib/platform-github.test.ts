import { describe, it, expect } from "vitest";
import { PlatformGitHub } from "./platform-github.js";

/**
 * The auth resolution (relocated from github-client.ts) without network: with
 * no App creds and no token, any call fails with the clear config error. Real
 * env values drive it — no mocks. Authenticated REST behavior is integration.
 */

describe("PlatformGitHub auth", () => {
  it("throws a clear config error when neither App creds nor a token are set", async () => {
    const gh = new PlatformGitHub({});

    await expect(gh.listIssues("re-cinq/lore")).rejects.toThrow(
      "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
    );
  });

  it("exposes the github port name", () => {
    expect(new PlatformGitHub({}).name).toBe("github");
  });
});
