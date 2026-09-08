import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import * as sharedStatus from "@re-cinq/lore-shared/spec-status.js";
import * as sharedCoverage from "@re-cinq/lore-shared/spec-status-coverage.js";
import * as sharedLinks from "@re-cinq/lore-shared/spec-link-parser.js";
import * as vendoredStatus from "@re-cinq/eslint-plugin-re-lint/spec/spec-status.js";
import * as vendoredCoverage from "@re-cinq/eslint-plugin-re-lint/spec/spec-status-coverage.js";
import * as vendoredLinks from "@re-cinq/eslint-plugin-re-lint/spec/spec-link-parser.js";

/**
 * The spec-traceability parsers exist twice: libs/shared is the source of
 * truth, and @re-cinq/eslint-plugin-re-lint vendors a copy so the markdown
 * rules can run in any repo. This checks the two agree on every spec and ADR
 * in this repo, so a parser change here fails CI until re-lint is bumped.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function markdownUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    if (statSync(full).isDirectory()) {
      return markdownUnder(full);
    }

    return name.endsWith(".md") ? [full] : [];
  });
}

const corpus = [
  ...markdownUnder(join(repoRoot, "specs")).filter((file) =>
    file.endsWith("spec.md"),
  ),
  ...markdownUnder(join(repoRoot, "adrs")),
].map((file) => ({
  path: relative(repoRoot, file),
  content: readFileSync(file, "utf8"),
}));

const kindOf = (path) => (path.startsWith("adrs/") ? "adr" : "spec");

test("parseDocStatus + statusTier agree on every spec and ADR", () => {
  const disagreements = corpus.filter(({ path, content }) => {
    const kind = kindOf(path);
    const shared = sharedStatus.parseDocStatus(content, kind);
    const vendored = vendoredStatus.parseDocStatus(content, kind);
    const sameTier =
      sharedStatus.statusTier(shared.status) ===
      vendoredStatus.statusTier(vendored.status);

    return JSON.stringify(shared) !== JSON.stringify(vendored) || !sameTier;
  });

  assert.deepEqual(
    disagreements.map((doc) => doc.path),
    [],
  );
});

test("statementCoverage agrees on every spec and ADR", () => {
  const disagreements = corpus.filter(({ content }) => {
    return (
      JSON.stringify(sharedCoverage.statementCoverage(content)) !==
      JSON.stringify(vendoredCoverage.statementCoverage(content))
    );
  });

  assert.deepEqual(
    disagreements.map((doc) => doc.path),
    [],
  );
});

test("linksForStatements agrees on every spec and ADR", () => {
  const disagreements = corpus.filter(({ content }) => {
    return (
      JSON.stringify(sharedLinks.linksForStatements(content)) !==
      JSON.stringify(vendoredLinks.linksForStatements(content))
    );
  });

  assert.deepEqual(
    disagreements.map((doc) => doc.path),
    [],
  );
});
