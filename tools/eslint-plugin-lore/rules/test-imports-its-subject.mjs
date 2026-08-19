/**
 * test-imports-its-subject — a `*.test.ts` file must import at least one
 * first-party module, so it exercises production code rather than a copy of it.
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
 * The bar here is "the module is loaded", which is exactly the bar the copy
 * failed.
 */

/** Suites that drive a system rather than one module, so no subject is implied. */
const EXEMPT_SUFFIXES = [
  ".integration.test",
  ".acceptance.test",
  ".e2e.test",
  ".contract.test",
];

/** `/a/b/scoring.test.ts` → `scoring`; null when this is not a test file. */
function subjectOf(filename) {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const match = base.match(/^(.*)\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/);

  if (!match) {
    return null;
  }

  const stem = match[1];

  return EXEMPT_SUFFIXES.some((s) => `${stem}.test`.endsWith(s)) ? null : stem;
}

/**
 * Does `source` load first-party production code?
 *
 * Deliberately NOT "does it match the filename". A first cut required the test
 * to import the module it is named after and flagged 86 files, nearly all
 * legitimate: `agent-events-oversized.test.ts` tests a facet of
 * `agent-events.ts`, and a suite may reach its subject through a barrel or a
 * sibling. The property worth enforcing is the one the copy violated — that the
 * test loads SOME production module rather than re-implementing its subject.
 */
function loadsProductionCode(source) {
  if (isTestRunner(source)) {
    return false;
  }

  // First-party: a relative path, or one of this repo's workspace packages.
  return source.startsWith(".") || source.startsWith("@re-cinq/");
}

function isTestRunner(source) {
  return ["vitest", "node:test", "@jest/globals", "chai", "assert"].includes(
    source,
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "a test file must import the module it is named after, so it exercises production code",
    },
    schema: [],
    messages: {
      noSubjectImport:
        "This test imports no first-party module — it loads nothing from this repo, so nothing here can fail when production code changes. A test that re-implements its subject (`{{subject}}`) proves only that the copy still agrees with itself.",
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

        if (loadsProductionCode(node.source.value)) {
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
          loadsProductionCode(node.source.value)
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
