import { describe, it, expect } from "vitest";
import { truncateForStorage } from "./truncate-for-storage.js";

describe("truncateForStorage", () => {
  it("returns the text unchanged when it is within the byte cap", () => {
    expect(truncateForStorage("short", 100)).toBe("short");
  });

  it("counts bytes rather than characters for multibyte text", () => {
    expect(truncateForStorage("é".repeat(10), 10)).toContain("[truncated");
  });

  it("marks the original byte length in the truncation marker", () => {
    expect(truncateForStorage("x".repeat(50), 10)).toBe(
      `${"x".repeat(10)}…[truncated, 50 bytes]`,
    );
  });
});
