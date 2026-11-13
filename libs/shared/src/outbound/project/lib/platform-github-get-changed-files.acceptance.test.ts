import { describe, it, expect, vi } from "vitest";
import { PlatformGitHub } from "./platform-github.js";
import { Octokit } from "octokit";

describe("PlatformGitHub.getChangedFiles", () => {
  it("returns the PR's paginated file list", async () => {
    const ok = new Octokit();
    const gh = new PlatformGitHub();

    vi.spyOn(gh as any, "octo").mockResolvedValue(ok);

    const fakeFiles = Array.from({ length: 150 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
    }));

    vi.spyOn(ok, "paginate").mockResolvedValue(fakeFiles);

    const files = await gh.getChangedFiles("re-cinq/lore", 7);

    expect(files).toHaveLength(150);
    expect(files).toContain("src/file0.ts");
    expect(files).toContain("src/file149.ts");
  });
});
