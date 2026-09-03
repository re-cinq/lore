import { describe, it, expect } from "vitest";
import {
  resolveRoute,
  routePlaceholders,
  isRouteArgPlaceholder,
} from "./run-graph.js";

describe("route placeholder grammar", () => {
  it("lists every braced placeholder's inner text", () => {
    expect(
      routePlaceholders("/repos/{args.repo}/features/{feature.id}"),
    ).toEqual(["args.repo", "feature.id"]);
  });

  it("accepts only args.<name> as a resolvable placeholder", () => {
    expect(isRouteArgPlaceholder("args.feature_id")).toBe(true);
    expect(isRouteArgPlaceholder("feature.id")).toBe(false);
    expect(isRouteArgPlaceholder("args.a.b")).toBe(false);
    expect(isRouteArgPlaceholder("")).toBe(false);
  });

  it("what the grammar accepts, resolveRoute resolves — one grammar, two readers", () => {
    const route = "/repos/{args.repo}";

    expect(routePlaceholders(route).every(isRouteArgPlaceholder)).toBe(true);
    expect(resolveRoute(route, { repo: "re-cinq/lore" })).toBe(
      "/repos/re-cinq/lore",
    );
  });
});

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
    expect(resolveRoute("{args.pr_url}", {})).toBeNull();
  });

  it("returns null for a route with no placeholders left unresolved and no args needed", () => {
    expect(resolveRoute(undefined, {})).toBeNull();
  });

  it("passes a placeholder-free route through untouched", () => {
    expect(resolveRoute("/tasks", {})).toBe("/tasks");
  });

  it("treats an empty-string arg as missing rather than building a broken href", () => {
    expect(
      resolveRoute("/repos/{args.repo}/features/{args.feature_id}", {
        repo: "",
        feature_id: "feat-1",
      }),
    ).toBeNull();
  });
});
