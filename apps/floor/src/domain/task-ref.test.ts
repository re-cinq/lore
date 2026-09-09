import { describe, it, expect } from "vitest";
import { loreTaskRef } from "./task-ref.js";

describe("loreTaskRef", () => {
  it("links to the deployed task page when a UI url is set", () => {
    expect(loreTaskRef("abc-123", "https://lore.example.com")).toBe(
      "[abc-123](https://lore.example.com/assembly-runs/abc-123)",
    );
  });

  it("trims a trailing slash on the UI url", () => {
    expect(loreTaskRef("abc-123", "https://lore.example.com/")).toBe(
      "[abc-123](https://lore.example.com/assembly-runs/abc-123)",
    );
  });

  it("returns the bare uuid when no UI url is configured", () => {
    expect(loreTaskRef("abc-123", undefined)).toBe("abc-123");
  });
});
