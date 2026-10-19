function isDocComment(comment) {
  return comment.type === "Block" && comment.value.startsWith("*");
}

function isTypeDeclaration(node) {
  return (
    node.type === "TSInterfaceDeclaration" ||
    node.type === "TSTypeAliasDeclaration" ||
    (node.type === "ExportNamedDeclaration" &&
      node.declaration != null &&
      isTypeDeclaration(node.declaration))
  );
}

/** Flags the first of two adjacent doc comments. The second doc comment
 *  describes the following declaration; the first describes nothing. */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Flag a doc comment stranded by function extraction — its next non-blank line is another doc comment.",
    },
    schema: [],
    messages: {
      stranded:
        "Doc comment is stranded — the next non-blank line is another doc comment, so this one describes nothing.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program() {
        const docComments = sourceCode
          .getAllComments()
          .filter(isDocComment)
          .sort((a, b) => a.range[0] - b.range[0]);

        const body = sourceCode.ast.body;

        for (let i = 0; i < docComments.length - 1; i++) {
          const current = docComments[i];
          const nextDoc = docComments[i + 1];
          const between = sourceCode.text.slice(
            current.range[1],
            nextDoc.range[0],
          );

          if (!/^\s*$/.test(between)) {
            continue;
          }

          const firstAfter = body.find((s) => s.range[0] >= nextDoc.range[1]);

          if (firstAfter && isTypeDeclaration(firstAfter)) {
            continue;
          }

          context.report({
            loc: current.loc,
            messageId: "stranded",
          });
        }
      },
    };
  },
};

export default rule;
