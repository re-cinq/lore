import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  stripCoverageLinks,
  SPEC_LINK_GROUP_SQL_PATTERN,
} from "./spec-link-strip.js";
import { enforceTrue } from "../lib/enforce.js";

const FIXTURES = [
  "Statement. ([validated by `x.test.ts:12`](libs/x.test.ts#L12))",
  "- **FR1.1** Ends with a commit. ([validated by `a.test.ts:6`](libs/a.test.ts#L6), [`b.test.ts:17`](libs/b.test.ts#L17); implemented by [`c.ts:30`](libs/c.ts#L30))\n- next",
  "One. ([implemented by `s.ts:122`](libs/s.ts#L122)) Two. ([validated by posts the whole EventInsert](libs/e.test.ts#L20))",
  "See [the runbook](runbooks/x.md) for details (not a link group).",
];

function sqlPatternAsJs(): RegExp {
  return new RegExp(
    ` ?${SPEC_LINK_GROUP_SQL_PATTERN.replaceAll("[:space:]", "\\s").replaceAll("[^]]", "[^\\]]")}`,
    "g",
  );
}

function repoRoot(): string {
  let dir = process.cwd();

  while (!existsSync(join(dir, "scripts", "infra", "setup-db.sh"))) {
    const parent = dirname(dir);

    enforceTrue(parent !== dir, Error, "repo root not found");
    dir = parent;
  }

  return dir;
}

describe("stripCoverageLinks", () => {
  it("removes '([validated by `x.test.ts:12`](x.test.ts#L12))' and leaves 'Statement.'", () => {
    expect(
      stripCoverageLinks(
        "Statement. ([validated by `x.test.ts:12`](libs/x.test.ts#L12))",
      ),
    ).toBe("Statement.");
  });

  it("removes a two-link list with an implemented-by tail spanning 180 chars", () => {
    const group =
      "([validated by `a.test.ts:6`](libs/a.test.ts#L6), [`b.test.ts:17`](libs/b.test.ts#L17); implemented by [`c.ts:30`](libs/c.ts#L30))";

    expect(
      stripCoverageLinks(
        `- **FR1.1** Every phase ends with a commit. ${group}\n- next`,
      ),
    ).toBe("- **FR1.1** Every phase ends with a commit.\n- next");
  });

  it("removes a bare '([implemented by …])' group and a titled '[validated by title](…)' link alike", () => {
    expect(
      stripCoverageLinks(
        "One. ([implemented by `s.ts:122`](libs/s.ts#L122)) Two. ([validated by posts the whole EventInsert](libs/e.test.ts#L20))",
      ),
    ).toBe("One. Two.");
  });

  it("leaves prose with an ordinary markdown link untouched", () => {
    const prose =
      "See [the runbook](runbooks/x.md) for details (not a link group).";

    expect(stripCoverageLinks(prose)).toBe(prose);
  });
});

describe("SPEC_LINK_GROUP_SQL_PATTERN", () => {
  it("strips the same 4 fixtures the JS stripper strips, once read as a JS regex", () => {
    expect(FIXTURES.map((f) => f.replace(sqlPatternAsJs(), ""))).toEqual(
      FIXTURES.map(stripCoverageLinks),
    );
  });

  it("is carried verbatim by migration 0070 and both baseline schema scripts", () => {
    const root = repoRoot();
    const carriers = [
      "infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0070_chunks_search_tsv_strip_links.sql",
      "scripts/infra/setup-db.sh",
      "scripts/infra/setup-local-schema.sh",
    ];

    expect(
      carriers.map((path) => [
        path,
        readFileSync(join(root, path), "utf8").includes(
          SPEC_LINK_GROUP_SQL_PATTERN,
        ),
      ]),
    ).toEqual(carriers.map((path) => [path, true]));
  });
});
