/**
 * require-spec-link — every `it()`/`test()` must be linked to a spec or ADR.
 *
 * Lore's spec-traceability system authors the link INSIDE the spec.md/adr `.md`
 * as an inline trailing parenthetical — `Statement. ([validated by](test.ts#L42))`.
 * This rule inverts that view: it goes over each test declaration and fails the
 * ones that no spec or ADR statement references, so tests cannot silently drift
 * out of spec coverage.
 *
 * A test is linked when the spec/adr corpus carries a `([validated by](this#Lnn))`
 * link whose line falls inside the test's line span, or a whole-file link (no
 * `#L`) to the file. The corpus is read once per process (memoized per specsRoot)
 * via the shared parser — see `lib/spec-link-index.mjs`. Type info is off for
 * test files, so this works from the ESTree AST + filename + filesystem only.
 *
 * Detect-only: writing the link needs a human to pick which statement the test
 * validates, not a codemod.
 */

import path from "node:path";
import { isTestFile } from "./lib/lore-shared.mjs";
import {
  buildLinkIndex,
  corpusExists,
  readSpecFiles,
  toPosix,
} from "./lib/spec-link-index.mjs";

/**
 * specsRoot+roots → index, so the corpus is walked once per process.
 *
 * Note: the cache is keyed on specsRoot only, with no mtime/content hash — a
 * single-pass `eslint`/CI run always reads fresh, but a long-lived ESLint
 * server (VS Code extension, --watch) will not see a spec link added after the
 * first lint until the server restarts.
 */
const indexCache = new Map();

/** specsRoots we've already warned about having no spec/adr corpus, so a
 * misconfigured run warns once instead of once per linted test file.
 *
 * Scope is the whole Node process, matching `indexCache` above. In a one-shot
 * `eslint`/CI run that is exactly one warning. In a long-lived ESLint server
 * (VS Code, --watch) the module is not re-required between cycles, so once a
 * specsRoot has warned it stays quiet even after the CWD is fixed — the same
 * process-lifetime memoization caveat the corpus cache carries. Restart the
 * server (or the editor) to re-arm the warning. */
const warnedMissingCorpus = new Set();

function getIndex(specsRoot, roots) {
  // `\0` separates every element so no root value can collide with the joiner.
  const key = [specsRoot, ...roots].join("\0");
  let index = indexCache.get(key);

  if (!index) {
    index = buildLinkIndex(readSpecFiles(specsRoot, roots));
    indexCache.set(key, index);
  }

  return index;
}

/** The base identifier of a (possibly chained) callee — `it` in `it.each([])(…)`. */
function rootCallName(callee) {
  let node = callee;

  while (node) {
    if (node.type === "Identifier") {
      return node.name;
    }

    if (node.type === "MemberExpression") {
      node = node.object;

      continue;
    }

    if (node.type === "CallExpression") {
      node = node.callee;

      continue;
    }

    // `it.each`table`(name, fn)` — the outer callee is a tagged template whose
    // `.tag` is the `it.each` member chain; drill into it or the test escapes.
    if (node.type === "TaggedTemplateExpression") {
      node = node.tag;

      continue;
    }

    return null;
  }

  return null;
}

/** A named test declaration: `it`/`test` (any modifier chain) with a string name. */
function isNamedTestCall(node) {
  const root = rootCallName(node.callee);

  if (root !== "it" && root !== "test") {
    return false;
  }
  const first = node.arguments[0];

  if (!first) {
    return false;
  }

  if (first.type === "Literal") {
    return typeof first.value === "string";
  }

  return first.type === "TemplateLiteral";
}

function isLinked(entry, startLine, endLine) {
  if (!entry) {
    return false;
  }

  if (entry.wholeFile) {
    return true;
  }

  for (const line of entry.lines) {
    if (line >= startLine && line <= endLine) {
      return true;
    }
  }

  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "require every test to be linked from a spec or ADR via an inline ([validated by](test.ts#Lline)) link. The spec/adr corpus is read once per process and memoized, so in a long-lived ESLint server (VS Code extension, --watch) a newly added link is not seen until the server restarts; a one-shot `eslint`/CI run always reads fresh.",
    },
    schema: [
      {
        type: "object",
        properties: {
          specsRoot: { type: "string" },
          roots: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unlinkedTest:
        "Test {{name}} has no spec link — add an inline ([validated by]({{file}}#L{{line}})) to the statement it validates in a specs/**/*.md or adrs/**/*.md file (or, if this test isn't tied to a spec statement, it may not belong in the traceable suite).",
    },
  },

  create(context) {
    // Match the same predicate `buildLinkIndex` uses to keep validated-by links
    // (isTestFile: .test./.spec./__tests__/…), so a linkable test can't escape
    // the rule on a naming variant.
    if (!isTestFile(toPosix(context.filename))) {
      return {};
    }
    const options = context.options[0] ?? {};
    const specsRoot = options.specsRoot ?? context.cwd;
    const roots = options.roots ?? ["specs", "adrs"];

    // With no corpus under specsRoot, every test would flag as unlinked — a
    // false-positive storm that means the run started outside the repo root
    // (e.g. `eslint apps/floor/` in a subdir). Warn once and skip rather than
    // report thousands of misleading errors.
    if (!corpusExists(specsRoot, roots)) {
      if (!warnedMissingCorpus.has(specsRoot)) {
        warnedMissingCorpus.add(specsRoot);
        console.warn(
          `[lore/require-spec-link] no ${roots.join("/")} directory under ${specsRoot} — ` +
            "run eslint from the repo root (or pass options.specsRoot). Skipping the spec-link check.",
        );
      }

      return {};
    }

    const index = getIndex(specsRoot, roots);
    const relPath = toPosix(path.relative(specsRoot, context.filename));
    const entry = index.get(relPath);

    return {
      CallExpression(node) {
        if (!isNamedTestCall(node)) {
          return;
        }
        const startLine = node.loc.start.line;
        const endLine = node.loc.end.line;

        if (isLinked(entry, startLine, endLine)) {
          return;
        }
        const first = node.arguments[0];
        const name =
          first.type === "Literal"
            ? String(first.value)
            : context.sourceCode.getText(first);

        context.report({
          node: node.callee,
          messageId: "unlinkedTest",
          data: { name, file: relPath, line: String(startLine) },
        });
      },
    };
  },
};
