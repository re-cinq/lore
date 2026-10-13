import { describe, it, expect } from "vitest";
import {
  workspaceSourceAliases,
  type SourceAlias,
} from "./workspace-source.js";

function resolveWith(aliases: SourceAlias[], specifier: string): string | null {
  for (const alias of aliases) {
    if (alias.find.test(specifier)) {
      return specifier.replace(alias.find, alias.replacement);
    }
  }

  return null;
}

describe("workspaceSourceAliases", () => {
  const aliases = workspaceSourceAliases();

  it("maps a package root, an exact subpath and a wildcard subpath of @re-cinq/lore-shared to their TypeScript sources", () => {
    expect({
      root: resolveWith(aliases, "@re-cinq/lore-shared"),
      exact: resolveWith(
        aliases,
        "@re-cinq/lore-shared/http/internal-token.js",
      ),
      wildcard: resolveWith(
        aliases,
        "@re-cinq/lore-shared/project/pulls/check-runs.js",
      ),
    }).toEqual({
      root: expect.stringMatching(/\/libs\/shared\/src\/index\.ts$/),
      exact: expect.stringMatching(
        /\/libs\/shared\/src\/lib\/internal-token\.ts$/,
      ),
      wildcard: expect.stringMatching(
        /\/libs\/shared\/src\/outbound\/project\/pulls\/check-runs\.ts$/,
      ),
    });
  });

  it("lets an exact export win over the wildcard that would also match it, as Node's export resolution does", () => {
    expect(
      resolveWith(
        aliases,
        "@re-cinq/lore-shared/project/leases/lease-backends.js",
      ),
    ).toMatch(
      /\/libs\/shared\/src\/outbound\/project\/leases\/lease-backends\.ts$/,
    );
    expect(
      resolveWith(
        aliases,
        "@re-cinq/lore-shared/project/assembly-runs/run-graph.js",
      ),
    ).toMatch(/\/libs\/shared\/src\/domain\/run-graph\.ts$/);
  });

  it("sends server-core's catch-all export last, after its named features and platform subpaths", () => {
    expect({
      feature: resolveWith(
        aliases,
        "@re-cinq/lore-server-core/features/repo/repo-detect.js",
      ),
      platform: resolveWith(
        aliases,
        "@re-cinq/lore-server-core/platform/otel.js",
      ),
      catchAll: resolveWith(aliases, "@re-cinq/lore-server-core/index.js"),
      stations: resolveWith(aliases, "@re-cinq/lore-stations"),
    }).toEqual({
      feature: expect.stringMatching(
        /\/libs\/server-core\/src\/work\/repo\/repo-detect\.ts$/,
      ),
      platform: expect.stringMatching(
        /\/libs\/server-core\/src\/outbound\/otel\.ts$/,
      ),
      catchAll: expect.stringMatching(/\/libs\/server-core\/src\/index\.ts$/),
      stations: expect.stringMatching(
        /\/apps\/stations\/src\/work\/index\.ts$/,
      ),
    });
  });

  it("leaves a specifier no workspace package exports alone, so a real npm package still resolves through node_modules", () => {
    expect(resolveWith(aliases, "zod")).toBe(null);
    expect(resolveWith(aliases, "@re-cinq/agent-contracts")).toBe(null);
  });
});
