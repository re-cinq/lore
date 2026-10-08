import { describe, expect, it } from "vitest";
import { permissionsFor } from "./git-credential.js";

describe("permissionsFor", () => {
  it("maps read access to contents:read and metadata:read only", () => {
    expect(permissionsFor("read")).toEqual({
      contents: "read",
      metadata: "read",
    });
  });

  it("maps write access to the minimum write permissions for a pod", () => {
    expect(permissionsFor("write")).toEqual({
      contents: "write",
      pull_requests: "write",
      issues: "write",
      metadata: "read",
    });
  });
});
