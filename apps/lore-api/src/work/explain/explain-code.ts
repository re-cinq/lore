import type { LlmProvider } from "@re-cinq/lore-shared/llm/llm-provider.js";
import type {
  LinkedStatement,
  LineSpan,
} from "@re-cinq/lore-shared/spec-trace/statements-at.js";

/** What a span with no spec link gets: the explanation is grounded in the specs, so without one there is nothing to say. */
export const NO_LINKS_ANSWER =
  "I don't know: no spec statement links these lines, so there is nothing to ground an explanation in.";

const SYSTEM_PROMPT = `You explain a piece of code to a developer who selected it.
The spec statements given are what the code is for; the code shows how it does it.
Write at most two short paragraphs of plain prose: no lists, no headings, no code blocks.
Ground every claim in the statements or the code. If the statements do not explain the code, say what they do cover and stop.`;

export interface ExplainDeps {
  llm: LlmProvider;
  statementsAt(span: LineSpan): Promise<LinkedStatement[]>;
}

export interface ExplainRequest {
  span: LineSpan;
  code: string;
}

export interface Explanation {
  answer: string;
  statements: LinkedStatement[];
  model: string | null;
}

/** Explains `code` from the spec statements that reach its span; answers NO_LINKS_ANSWER, without a model call, when none do. */
export async function explainCode(
  deps: ExplainDeps,
  request: ExplainRequest,
): Promise<Explanation> {
  const statements = await deps.statementsAt(request.span);

  if (statements.length === 0) {
    return { answer: NO_LINKS_ANSWER, statements, model: null };
  }
  const { text, model } = await deps.llm.complete({
    systemPrompt: SYSTEM_PROMPT,
    prompt: explainPrompt(request, statements),
    maxTokens: 600,
    temperature: 0,
    jobName: "explain-code",
  });

  return { answer: text.trim(), statements, model };
}

const REACH_WORDING: Record<LinkedStatement["via"], string> = {
  validated: "a test in these lines validates it",
  implemented: "the spec links these lines as its implementation",
  covered: "a test validating it runs these lines",
};

export function explainPrompt(
  { span, code }: ExplainRequest,
  statements: LinkedStatement[],
): string {
  const statementLines = statements
    .map((statement) => `- ${statement.text} (${REACH_WORDING[statement.via]})`)
    .join("\n");

  return `File: ${span.file} lines ${span.startLine}-${span.endLine}

Spec statements linked to these lines:
${statementLines}

Code:
${code}

What does this code do?`;
}
