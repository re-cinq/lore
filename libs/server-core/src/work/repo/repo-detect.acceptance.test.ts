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

  it("caches the null result so a second call does not re-run git", () => {
    execSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(detectCurrentRepo()).toBeNull();
    expect(detectCurrentRepo()).toBeNull();
    expect(execSync).toHaveBeenCalledTimes(1);
  });
});
