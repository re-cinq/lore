/**
 * test-imports-its-subject — a `*.test.ts` file must load the real thing it
 * tests: a first-party module, or (for a suite whose subject is an artifact
 * rather than code) the file itself, read from disk. Never a copy.
 *
 * Written after `memory-lifecycle.test.ts` was found importing only vitest and
 * then defining its own copy of the function it claimed to test, under the
 * comment "(copied from memory-lifecycle.ts)". Eleven scoring tests and three
 * parsing tests were green against re-implementations, with fourteen spec
 * anchors reporting those statements covered. A change to production code could
 * not have failed any of them.
 *
 * A `[validated by]` link proves a test EXISTS. This is the cheapest available
 * proof that the test also RUNS the thing.
 *
 * Deliberately not checked: whether the imported binding is actually called. A
 * test can legitimately import a type-adjacent helper and exercise the subject
 * indirectly, and chasing that needs type information this rule does not have.
 * The bar here is "the real subject is loaded", which is exactly the bar the
 * copy failed.
 */

/** Suites that drive a system rather than one module, so no subject is implied. */
const EXEMPT_SUFFIXES = [
  ".integration.test",
  ".acceptance.test",
  ".e2e.test",
  ".contract.test",
];

/** The same exemption spelled as a directory, which is how lore-api spells it. */
const EXEMPT_DIRS = ["integration-tests"];

/** `/a/b/scoring.test.ts` → `scoring`; null when this is not a test file. */
function subjectOf(filename) {
  const segments = filename.split(/[/\\]/);
  const base = segments.pop() ?? "";
  const match = base.match(/^(.*)\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/);

  if (!match) {
    return null;
  }

  if (segments.some((segment) => EXEMPT_DIRS.includes(segment))) {
    return null;
  }

  const stem = match[1];

  return EXEMPT_SUFFIXES.some((s) => `${stem}.test`.endsWith(s)) ? null : stem;
}

/**
 * Does `source` load the real subject?
 *
 * Deliberately NOT "does it match the filename". A first cut required the test
 * to import the module it is named after and flagged 86 files, nearly all
 * legitimate: `agent-events-oversized.test.ts` tests a facet of
 * `agent-events.ts`, and a suite may reach its subject through a barrel or a
 * sibling. The property worth enforcing is the one the copy violated — that the
 * test loads SOME production module rather than re-implementing its subject.
 *
 * `node:fs` counts, because a suite that reads a repo file asserts on the very
 * artifact it names: a migration's SQL, a stylesheet's tokens, the PR template,
 * package.json, the source tree itself. Its subject is a file rather than a
 * module, so there is no module for it to import, and it is copying nothing —
 * which is the whole failure this rule exists to catch. Only `fs` earns this;
 * another builtin (`node:crypto` under a hand-rolled HMAC) is a re-implementation
 * wearing an import.
 */
function loadsRealSubject(source) {
  // First-party: a relative path, or one of this repo's workspace packages.
  // No test-runner exclusion is needed — "vitest", "node:test", "@jest/globals",
  // "chai" and "assert" all fail every check already, so an explicit guard for
  // them never changed the answer.
  return (
    source.startsWith(".") ||
    source.startsWith("@re-cinq/") ||
    source === "node:fs" ||
    source === "fs"
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "a test file must load the real thing it tests — a first-party module, or the artifact it reads from disk",
    },
    schema: [],
    messages: {
      noSubjectImport:
        "This test loads nothing real — no first-party module, and no file read from disk — so nothing here can fail when production code changes. A test that re-implements its subject (`{{subject}}`) proves only that the copy still agrees with itself.",
    },
  },

  create(context) {
    const subject = subjectOf(context.filename);

    if (!subject) {
      return {};
    }

    let importsSubject = false;

    return {
      // Type-only imports are erased at runtime, so they load nothing.
      ImportDeclaration(node) {
        if (node.importKind === "type") {
          return;
        }

        if (loadsRealSubject(node.source.value)) {
          importsSubject = true;
        }
      },

      // `vi.mock(...)` then `await import("./subject.js")` is the standard shape
      // for testing a module with its dependencies replaced — the static import
      // has to be deferred, so counting only ImportDeclaration would flag every
      // suite that mocks anything.
      ImportExpression(node) {
        if (
          node.source.type === "Literal" &&
          typeof node.source.value === "string" &&
          loadsRealSubject(node.source.value)
        ) {
          importsSubject = true;
        }
      },

      "Program:exit"(node) {
        if (importsSubject) {
          return;
        }

        context.report({
          node,
          loc: { line: 1, column: 0 },
          messageId: "noSubjectImport",
          data: { subject },
        });
      },
    };
  },
};
