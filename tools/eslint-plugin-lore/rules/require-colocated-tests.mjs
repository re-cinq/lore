/**
 * require-colocated-tests — every test must live next to the source it covers,
 * never inside a `__tests__/` directory. ESLint can't move files, so this is
 * report-only; the fix is to relocate the file beside its source.
 */

export default {
  meta: {
    type: "problem",
    docs: {
      description: "tests must be colocated with their source, not in __tests__/",
    },
    schema: [],
    messages: {
      colocate:
        "Test files must be colocated next to their source, not in a __tests__/ directory.",
    },
  },

  create(context) {
    const inTestsDir = context.filename.split(/[/\\]/).includes("__tests__");
    if (!inTestsDir) return {};

    return {
      Program(node) {
        context.report({ node, loc: { line: 1, column: 0 }, messageId: "colocate" });
      },
    };
  },
};
