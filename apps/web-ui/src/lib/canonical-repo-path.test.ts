import { describe, it, expect } from "vitest";
import { canonicalRepoRedirect } from "./canonical-repo-path";

describe("canonicalRepoRedirect", () => {
  it("redirects re-cinq/otto/plans to re-cinq/Otto/plans when full_name is re-cinq/Otto", () => {
    expect(
      canonicalRepoRedirect("/repos/re-cinq/otto/plans", "", "re-cinq/Otto"),
    ).toBe("/repos/re-cinq/Otto/plans");
  });

  it("keeps the query string on the redirect", () => {
    expect(
      canonicalRepoRedirect(
        "/repos/re-cinq/otto/tasks",
        "?status=open",
        "re-cinq/Otto",
      ),
    ).toBe("/repos/re-cinq/Otto/tasks?status=open");
  });

  it("returns null when the path already matches full_name's casing", () => {
    expect(
      canonicalRepoRedirect("/repos/re-cinq/Otto/plans", "", "re-cinq/Otto"),
    ).toBeNull();
  });

  it("returns null for the repo root with no trailing tab", () => {
    expect(
      canonicalRepoRedirect("/repos/re-cinq/Otto", "", "re-cinq/Otto"),
    ).toBeNull();
  });

  it("returns null when lore-api names no repo (left to 404 downstream)", () => {
    expect(
      canonicalRepoRedirect("/repos/re-cinq/otto/plans", "", null),
    ).toBeNull();
  });

  it("returns null for a path outside /repos", () => {
    expect(
      canonicalRepoRedirect("/assembly-runs/123", "", "re-cinq/Otto"),
    ).toBeNull();
  });
});
