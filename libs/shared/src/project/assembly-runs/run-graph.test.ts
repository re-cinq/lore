import { describe, it, expect } from "vitest";
import { resolveRoute } from "./run-graph.js";

describe("resolveRoute", () => {
  it("substitutes every placeholder from the run's args", () => {
    expect(
      resolveRoute("/repos/{args.repo}/features/{args.feature_id}", {
        repo: "re-cinq/lore",
        feature_id: "feat-1",
      }),
    ).toBe("/repos/re-cinq/lore/features/feat-1");
  });

  it("substitutes a numeric arg", () => {
    expect(
      resolveRoute("{args.pr_url}#pr-{args.pr_number}", {
        pr_url: "https://github.com/re-cinq/lore/pull/42",
        pr_number: 42,
      }),
    ).toBe("https://github.com/re-cinq/lore/pull/42#pr-42");
  });

  it("returns null while a placeholder's arg does not exist yet", () => {
    // pr_url is absent until the push node opens the PR; a half-built href
    // sends the reader to a page that does not exist.
    expect(resolveRoute("{args.pr_url}", {})).toBeNull();
  });

  it("returns null for a route with no placeholders left unresolved and no args needed", () => {
    expect(resolveRoute(undefined, {})).toBeNull();
  });

  it("passes a placeholder-free route through untouched", () => {
    expect(resolveRoute("/tasks", {})).toBe("/tasks");
  });

  it("treats an empty-string arg as missing rather than building a broken href", () => {
    // /repos//features/feat-1 is exactly the half-built link the null contract
    // exists to prevent.
    expect(
      resolveRoute("/repos/{args.repo}/features/{args.feature_id}", {
        repo: "",
        feature_id: "feat-1",
      }),
    ).toBeNull();
  });
});
