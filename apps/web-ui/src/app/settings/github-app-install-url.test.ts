import { describe, it, expect } from "vitest";
import { githubAppInstallUrl } from "./github-app-install-url";

describe("githubAppInstallUrl", () => {
  it("builds the lore-agent App's install URL from its slug", () => {
    expect(githubAppInstallUrl("lore-agent")).toBe(
      "https://github.com/apps/lore-agent/installations/new",
    );
  });
});
