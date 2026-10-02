// One document's context eval (specs/context-evals): the model writes a question the document answers, Lore assembles context for it as it would for an agent, and the result says whether the document came back, whether the question could be answered from what came back, and how much of it was used.

import type { LlmProvider } from "@re-cinq/lore-shared/llm/llm-provider.js";

const JOB_NAME = "context-evals";
const MAX_DOCUMENT_CHARS = 12_000;
const NO_CONTEXT = "Lore returned no context for the question";

/** One document Lore put in an assembled context, and how many tokens it took. */
export interface AssembledSource {
  path: string;
  tokens: number;
}

export interface AssembledForEval {
  text: string;
  sources: AssembledSource[];
}

export interface EvalDeps {
  llm: LlmProvider;
  /** The ingested text of one document; null when Lore does not hold it. */
  document(repo: string, path: string): Promise<string | null>;
  /** What an agent asking `question` about `repo` would be handed. */
  assemble(repo: string, question: string): Promise<AssembledForEval>;
}

export interface DocumentEval {
  path: string;
  question: string;
  found: boolean;
  answered: boolean;
  /** The tokens of the sources the answer used, over all tokens returned. */
  useful_share: number;
  reason: string;
  model: string;
}

interface Answer {
  answer: string;
  used_sources: string[];
}

interface Verdict {
  pass: boolean;
  reason: string;
}

const QUESTION_SYSTEM =
  "You write one question to test a search system. Given a document from a software repository, write a single question that a developer who has never seen this document would ask while working, and that this document answers. Ask about what the document decides or requires, not about the document itself. Do not name the document, its number, its title or its file path. Reply with the question only.";

const ANSWER_SYSTEM =
  "You answer a developer's question using only the context you are given. The context is a list of <document> blocks, each with a source attribute. If the context does not answer the question, say that it does not; never answer from your own knowledge. List in used_sources the source attribute of every document your answer relied on, and no others.";

const JUDGE_SYSTEM =
  "You grade an answer against a reference document. Pass the answer only when what it states agrees with the document and it actually answers the question. Fail an answer that contradicts the document, that says the context did not contain the answer, or that is too vague to act on. Give the reason in one sentence.";

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    used_sources: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "used_sources"],
};

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["pass", "reason"],
};

/** Evaluates one document; null when Lore holds no such document. */
export async function evaluateDocument(
  deps: EvalDeps,
  target: { repo: string; path: string },
): Promise<DocumentEval | null> {
  const stored = await deps.document(target.repo, target.path);

  return stored === null
    ? null
    : evaluateStored(deps, target, stored.slice(0, MAX_DOCUMENT_CHARS));
}

async function evaluateStored(
  deps: EvalDeps,
  target: { repo: string; path: string },
  document: string,
): Promise<DocumentEval> {
  const { question, model } = await writeQuestion(deps.llm, document);
  const assembled = await deps.assemble(target.repo, question);
  const graded = await gradeAssembled(deps.llm, {
    document,
    question,
    assembled,
  });

  return {
    path: target.path,
    question,
    found: assembled.sources.some((source) => source.path === target.path),
    model,
    ...graded,
  };
}

async function writeQuestion(
  llm: LlmProvider,
  document: string,
): Promise<{ question: string; model: string }> {
  const { text, model } = await llm.complete({
    systemPrompt: QUESTION_SYSTEM,
    prompt: `Document:\n\n${document}`,
    jobName: JOB_NAME,
  });

  return { question: text.trim(), model };
}

interface Graded {
  answered: boolean;
  useful_share: number;
  reason: string;
}

interface Attempt {
  document: string;
  question: string;
  assembled: AssembledForEval;
}

async function gradeAssembled(
  llm: LlmProvider,
  attempt: Attempt,
): Promise<Graded> {
  const { sources } = attempt.assembled;

  if (sources.length === 0) {
    return { answered: false, useful_share: 0, reason: NO_CONTEXT };
  }
  const answer = await answerFromContext(llm, attempt);
  const verdict = await judgeAnswer(llm, attempt, answer.answer);

  return {
    answered: verdict.pass,
    useful_share: usefulShare(sources, answer.used_sources),
    reason: verdict.reason,
  };
}

async function answerFromContext(
  llm: LlmProvider,
  { question, assembled }: Attempt,
): Promise<Answer> {
  const { parsed } = await llm.completeWithTool<Answer>({
    systemPrompt: ANSWER_SYSTEM,
    prompt: `Context:\n\n${assembled.text}\n\nQuestion: ${question}`,
    toolName: "answer",
    toolDescription: "The answer and the sources it relied on",
    toolSchema: ANSWER_SCHEMA,
    jobName: JOB_NAME,
  });

  return parsed;
}

async function judgeAnswer(
  llm: LlmProvider,
  { document, question }: Attempt,
  answer: string,
): Promise<Verdict> {
  const { parsed } = await llm.completeWithTool<Verdict>({
    systemPrompt: JUDGE_SYSTEM,
    prompt: `Reference document:\n\n${document}\n\nQuestion: ${question}\n\nAnswer to grade: ${answer}`,
    toolName: "verdict",
    toolDescription: "Whether the answer agrees with the document, and why",
    toolSchema: VERDICT_SCHEMA,
    jobName: JOB_NAME,
  });

  return parsed;
}

/** The share of returned tokens that came from sources the answer used, to two decimals; a source the answer names but Lore did not return counts for nothing. */
export function usefulShare(
  sources: AssembledSource[],
  usedPaths: string[],
): number {
  const total = sumTokens(sources);

  if (total === 0) {
    return 0;
  }
  const used = sumTokens(
    sources.filter((source) => usedPaths.includes(source.path)),
  );

  return Math.round((used / total) * 100) / 100;
}

function sumTokens(sources: AssembledSource[]): number {
  return sources.reduce((sum, source) => sum + source.tokens, 0);
}
