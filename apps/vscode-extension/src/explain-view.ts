import type { ExplainSpan, Explanation } from "./lore-client.js";

const REACH_WORDING: Record<Explanation["statements"][number]["via"], string> =
  {
    validated: "a test in these lines validates it",
    implemented: "the spec links these lines as its implementation",
    covered: "a test validating it runs these lines",
  };

/** The markdown page "What does this do?" opens beside the code: the answer, then the statements it rests on. */
export function explanationMarkdown(
  span: Omit<ExplainSpan, "code">,
  { answer, statements }: Explanation,
): string {
  const heading = `# ${span.path} lines ${span.start_line}-${span.end_line}\n\n${answer}\n`;

  if (statements.length === 0) {
    return heading;
  }
  const statementLines = statements.map(
    (statement) => `- ${statement.text} *(${REACH_WORDING[statement.via]})*`,
  );

  return `${heading}\n## Spec statements\n\n${statementLines.join("\n")}\n`;
}
