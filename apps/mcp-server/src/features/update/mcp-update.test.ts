import { describe, it, expect } from "vitest";
import { deriveUpdateStatus } from "./mcp-update.js";

describe("deriveUpdateStatus", () => {
  it("origin/main 3 commits ahead of the build returns updateAvailable with commitsBehind 3", () => {
    expect(deriveUpdateStatus("aaaaaaa", "bbbbbbb", 3)).toEqual({
      updateAvailable: true,
      commitsBehind: 3,
      builtSha: "aaaaaaa",
      remoteSha: "bbbbbbb",
    });
  });

  it("identical build and remote SHAs return not available", () => {
    expect(deriveUpdateStatus("aaaaaaa", "aaaaaaa", 0)).toEqual({
      updateAvailable: false,
      commitsBehind: 0,
      builtSha: "aaaaaaa",
      remoteSha: "aaaaaaa",
    });
  });

  it("zero commits behind despite differing SHAs returns not available", () => {
    expect(deriveUpdateStatus("aaaaaaa", "bbbbbbb", 0)).toEqual({
      updateAvailable: false,
      commitsBehind: 0,
      builtSha: "aaaaaaa",
      remoteSha: "bbbbbbb",
    });
  });

  it("missing build SHA returns not available", () => {
    expect(deriveUpdateStatus(null, "bbbbbbb", 5)).toEqual({
      updateAvailable: false,
      commitsBehind: 0,
      builtSha: null,
      remoteSha: "bbbbbbb",
    });
  });
});
