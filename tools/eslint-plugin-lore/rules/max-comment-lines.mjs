/**
 * max-comment-lines — a comment may span at most `max` lines; `max: 0` bans
 * comments outright (the test-file setting, where the test NAME is the
 * documentation). The house style wants code that reveals intent on its own:
 * a comment states a constraint the code cannot show, in one short sentence,
 * or it does not exist. Multi-line essays belong in specs/ADRs, where they are
 * ingested, searchable, and linked — not entombed above a function.
 *
 * What is counted: a block comment's line span, and a RUN of consecutive `//`
 * line comments (adjacent lines, uninterrupted) counted as one comment. A run
 * of three `//` lines is a three-line comment wearing a disguise.
 *
 * Always exempt, regardless of `max`: tooling directives the toolchain itself
 * reads — `eslint-disable*`/`eslint-enable`, `@ts-expect-error`/`@ts-ignore`/
 * `@ts-nocheck`, triple-slash references, `@vitest-environment`, istanbul/c8
 * coverage hints, `jscpd:ignore` fences, and the shebang. A directive is an
 * instruction to a machine, not prose to a human.
 *
 * Detect-only: compressing prose into a sentence (or deleting it) is judgment.
 */

const DIRECTIVE_PATTERN =
  /^\s*(eslint-(disable|enable)|@ts-(expect-error|ignore|nocheck)|\/\s*<reference|@vitest-environment|istanbul\s|c8\s|jscpd:ignore)/;

function isDirective(comment) {
  if (comment.type === "Shebang") {
    return true;
  }

  return DIRECTIVE_PATTERN.test(comment.value);
}

function groupLineRuns(comments) {
  const runs = [];
  let run = null;

  for (const comment of comments) {
    const extendsRun =
      run && comment.loc.start.line === run.endLine + 1;

    if (extendsRun) {
      run.comments.push(comment);
      run.endLine = comment.loc.end.line;

      continue;
    }

    run = {
      comments: [comment],
      endLine: comment.loc.end.line,
    };
    runs.push(run);
  }

  return runs;
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Limit how many lines a comment (or run of consecutive line comments) may span; 0 bans comments entirely",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 0 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong:
        "Comment spans {{count}} lines (max {{max}}) — state the one constraint the code cannot show, or move the essay to a spec/ADR.",
      noComments:
        "No comments in test files — the test name and the code must carry the meaning.",
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? 1;

    function report(node, count) {
      if (max === 0) {
        context.report({ node, messageId: "noComments" });

        return;
      }

      context.report({
        node,
        messageId: "tooLong",
        data: { count, max },
      });
    }

    return {
      Program() {
        const comments = context.sourceCode
          .getAllComments()
          .filter((comment) => !isDirective(comment));
        const blocks = comments.filter((c) => c.type === "Block");
        const lines = comments.filter((c) => c.type === "Line");

        for (const block of blocks) {
          const span = block.loc.end.line - block.loc.start.line + 1;

          if (span > max) {
            report(block, span);
          }
        }

        for (const run of groupLineRuns(lines)) {
          if (run.comments.length > max) {
            report(run.comments[0], run.comments.length);
          }
        }
      },
    };
  },
};
