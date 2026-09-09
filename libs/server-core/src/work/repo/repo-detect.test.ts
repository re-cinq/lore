import { describe, it, expect, beforeEach, vi } from "vitest";

const execSync = vi.fn();

vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => execSync(...args),
}));

import { detectCurrentRepo, resetRepoCache } from "./repo-detect.js";

describe("detectCurrentRepo", () => {
  beforeEach(() => {
    resetRepoCache();
    execSync.mockReset();
  });

  it("parses an SSH remote into owner/repo", () => {
    execSync.mockReturnValue("git@github.com:re-cinq/lore.git\n");
    expect(detectCurrentRepo()).toBe("re-cinq/lore");
  });

  it("parses an HTTPS remote with and without the .git suffix", () => {
    execSync.mockReturnValue("https://github.com/re-cinq/lore.git\n");
    expect(detectCurrentRepo()).toBe("re-cinq/lore");
    resetRepoCache();
    execSync.mockReturnValue("https://github.com/re-cinq/lore\n");
    expect(detectCurrentRepo()).toBe("re-cinq/lore");
  });

  it("returns null when the git command throws", () => {
    execSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(detectCurrentRepo()).toBeNull();
  });

  it("caches the result and does not re-run git on the second call", () => {
    execSync.mockReturnValue("git@github.com:re-cinq/lore.git\n");
    expect(detectCurrentRepo()).toBe("re-cinq/lore");
    expect(detectCurrentRepo()).toBe("re-cinq/lore");
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it("re-runs git after resetRepoCache clears the cache", () => {
    execSync.mockReturnValue("git@github.com:re-cinq/lore.git\n");
    detectCurrentRepo();
    resetRepoCache();
    execSync.mockReturnValue("git@github.com:re-cinq/other.git\n");
    expect(detectCurrentRepo()).toBe("re-cinq/other");
    expect(execSync).toHaveBeenCalledTimes(2);
  });
});
