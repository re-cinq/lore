import { describe, it, expect } from "vitest";
import { GithubTokenMinter } from "./kube-token-provisioner.js";

describe("GithubTokenMinter", () => {
  it("returns the installation token for the repo", async () => {
    const minter = new GithubTokenMinter({
      getInstallationToken: async () => "ghs_realtoken",
    });

    expect(await minter.mint("re-cinq/lore")).toBe("ghs_realtoken");
  });

  it("throws naming the repo and the App vars when the token comes back empty", async () => {
    const minter = new GithubTokenMinter({
      getInstallationToken: async () => "",
    });

    await expect(minter.mint("re-cinq/lore")).rejects.toThrow(
      new Error(
        "minted an empty GitHub token for re-cinq/lore — check GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID",
      ),
    );
  });
});
