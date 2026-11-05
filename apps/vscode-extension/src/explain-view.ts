import type { Explanation } from "./lore-client.js";

type Reach = Explanation["statements"][number]["via"];

const REACH_WORDING: Record<Reach, string> = {
  validated: "a test in these lines validates it",
  implemented: "the spec links these lines as its implementation",
  covered: "a test validating it runs these lines",
};

const LISTED_STATEMENTS = 3;

/** The hover on an explained span: the answer, then the first few statements it rests on. */
export function explanationMarkdown({
  answer,
  statements,
}: Explanation): string {
  if (statements.length === 0) {
    return `${answer}\n`;
  }
  const listed = statements
    .slice(0, LISTED_STATEMENTS)
    .map(
      (statement) => `- ${statement.text} *(${REACH_WORDING[statement.via]})*`,
    );
  const hidden = statements.length - listed.length;
  const more = hidden > 0 ? `\nand ${hidden} more\n` : "";

  return `${answer}\n\n**Spec statements**\n\n${listed.join("\n")}\n${more}`;
}
