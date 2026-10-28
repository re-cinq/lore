// One document's context eval (specs/context-evals): the model writes a question the document answers, Lore assembles context for it as it would for an agent, and the result says whether the document came back, whether the question could be answered from what came back, and how much of it was used.

import type { LlmProvider } from "@re-cinq/lore-shared/llm/llm-provider.js";
import type { KnowledgeBackend } from "@re-cinq/lore-shared/knowledge-backend.js";
import {
  sideBySide,
  type SideBySideEval,
  type SingleBackend,
} from "./side-by-side.js";

const JOB_NAME = "context-evals";
const MAX_DOCUMENT_CHARS = 12_000;

/** One document Lore put in an assembled context: the section it came under, and how many tokens it took. */
export interface AssembledSource {
  path: string;
  section: string;
  tokens: number;
}

/** A returned source as graded: whether the answer relied on it. */
export interface GradedSource extends AssembledSource {
  used: boolean;
}

export interface AssembledForEval {
  text: string;
  sources: AssembledSource[];
}

export interface EvalDeps {
  llm: LlmProvider;
  /** The model the verdict is asked of, when it should be a stronger one than the model that writes and answers; the provider's default otherwise. */
  judgeModel?: string;
  /** The ingested text of one document; null when Lore does not hold it. */
  document(repo: string, path: string): Promise<string | null>;
  /** What an agent asking `question` about `repo` would be handed, from `backend` when one is named. */
  assemble(
    repo: string,
    question: string,
    backend?: KnowledgeBackend,
  ): Promise<AssembledForEval>;
  /** Milliseconds, for the assembly latency a side-by-side eval reports; `performance.now` otherwise. */
  clock?: () => number;
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
  sources: GradedSource[];
}

interface Answer {
  answer: string;
  used_sources: string[];
}

/** What the judge reports; whether that is a pass is decided in code, where a claimed contradiction can be checked against the document. */
// eslint-disable-next-line re-lint/no-row-types-outside-models -- the judge tool's own output, named for the model that fills it; no table holds it
export interface Judgement {
  addresses_question: boolean;
  /** The sentence of the document the answer contradicts, quoted; empty or absent when it contradicts none. */
  contradicted_sentence?: string;
  /** True when the quoted sentence and the answer can both be true at once: two facts about one thing are not a contradiction. */
  both_can_hold?: boolean;
  reason: string;
}

const QUESTION_SYSTEM =
  'You write one question to test a search system. Given a document from a software repository, write a single question that a developer who has never seen this document would ask while working, and that this document answers. Ask about what the document decides or requires, not about the document itself. Do not name the document, its number, its title or its file path. The question must stand on its own: name the tool, route, component or rule it asks about, and never write "this tool", "this document" or "the above". Reply with the question only.';

const ANSWER_SYSTEM =
  "You answer a developer's question using only the context you are given. The context is a list of <document> blocks, each with a source attribute. If the context does not answer the question, say that it does not; never answer from your own knowledge. List in used_sources the source attribute of every document your answer relied on, and no others.";

// The answer is drawn from everything Lore returned, so it may hold true detail the reference never mentions. A contradiction has to be quoted, which a "not mentioned" cannot be.
const JUDGE_SYSTEM =
  "You compare an answer with a reference document. The answer was written from several documents, so it may contain correct details the reference does not mention; an absent detail is not a contradiction. Report three things, then the reason. addresses_question: false when the answer says the context did not contain the answer or does not address what was asked, true otherwise. contradicted_sentence: when a statement in the answer cannot be true if the reference is true, copy the one sentence of the reference it conflicts with, word for word; when there is no such sentence, leave it empty. both_can_hold: true when that sentence and the answer can both be true at the same time, for instance when one states a default and the other a check made at startup, or when the answer simply says more; false only when one of them has to be wrong. Give the reason in one sentence.";

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    used_sources: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "used_sources"],
};

const JUDGEMENT_SCHEMA = {
  type: "object",
  properties: {
    addresses_question: { type: "boolean" },
    contradicted_sentence: { type: "string" },
    both_can_hold: { type: "boolean" },
    reason: { type: "string" },
  },
  required: [
    "addresses_question",
    "contradicted_sentence",
    "both_can_hold",
    "reason",
  ],
};

export interface EvalTarget {
  repo: string;
  path: string;
  /** Grade this question instead of writing one, so a rerun after a fix measures the same thing. */
  question?: string;
  /** The store the assembly reads; unset follows the repo's setting, then Utopia. */
  backend?: KnowledgeBackend;
}

/** Evaluates one document; null when Lore holds no such document. Under `both` it is graded on each store's own assembly, side by side. */
export async function evaluateDocument(
  deps: EvalDeps,
  target: EvalTarget,
): Promise<DocumentEval | SideBySideEval | null> {
  const stored = await deps.document(target.repo, target.path);

  if (stored === null) {
    return null;
  }
  const document = stored.slice(0, MAX_DOCUMENT_CHARS);

  return target.backend === "both"
    ? evaluateSideBySide(deps, target, document)
    : evaluateStored(deps, target, document);
}

async function evaluateSideBySide(
  deps: EvalDeps,
  target: EvalTarget,
  document: string,
): Promise<SideBySideEval> {
  const question = await questionFor(deps.llm, target, document);
  const lore = await timedAssembly(deps, target.repo, question, "lore");
  const utopia = await timedAssembly(deps, target.repo, question, "utopia");
  const [loreSide, utopiaSide] = await Promise.all(
    [lore, utopia].map(async ({ assembled, latency_ms }) => ({
      found: isFound(assembled, target.path),
      ...(await gradeAssembled(deps, { document, question, assembled })),
      latency_ms,
    })),
  );

  return sideBySide({ path: target.path, question }, loreSide, utopiaSide);
}

async function timedAssembly(
  { assemble, clock = () => performance.now() }: EvalDeps,
  repo: string,
  question: string,
  backend: SingleBackend,
): Promise<{ assembled: AssembledForEval; latency_ms: number }> {
  const started = clock();
  const assembled = await assemble(repo, question, backend);

  return { assembled, latency_ms: Math.round(clock() - started) };
}

function isFound(assembled: AssembledForEval, path: string): boolean {
  return assembled.sources.some((source) => source.path === path);
}

async function evaluateStored(
  deps: EvalDeps,
  target: EvalTarget,
  document: string,
): Promise<DocumentEval> {
  const question = await questionFor(deps.llm, target, document);
  const assembled = await deps.assemble(target.repo, question, target.backend);
  const graded = await gradeAssembled(deps, {
    document,
    question,
    assembled,
  });

  return {
    path: target.path,
    question,
    found: isFound(assembled, target.path),
    ...graded,
  };
}

/** The question the caller pinned, or one written from the document. */
async function questionFor(
  llm: LlmProvider,
  target: EvalTarget,
  document: string,
): Promise<string> {
  return target.question ?? writeQuestion(llm, document);
}

async function writeQuestion(
  llm: LlmProvider,
  document: string,
): Promise<string> {
  const { text } = await llm.complete({
    systemPrompt: QUESTION_SYSTEM,
    prompt: `Document:\n\n${document}`,
    jobName: JOB_NAME,
    temperature: 0,
  });

  return text.trim();
}

type Graded = Omit<DocumentEval, "path" | "question" | "found">;

const UNGRADED: Graded = {
  answered: false,
  useful_share: 0,
  reason: "Lore returned no context for the question",
  model: "",
  sources: [],
};

interface Attempt {
  document: string;
  question: string;
  assembled: AssembledForEval;
}

async function gradeAssembled(
  deps: EvalDeps,
  attempt: Attempt,
): Promise<Graded> {
  const { sources } = attempt.assembled;

  if (sources.length === 0) {
    return UNGRADED;
  }
  const { parsed: answer, model } = await answerFromContext(deps.llm, attempt);
  const judged = await judgeAnswer(deps, attempt, answer.answer);

  // The model reported is the one that answered: the question's is the same, and the judge's may be another.
  return {
    answered: passes(judged.judgement, attempt.document),
    useful_share: usefulShare(sources, answer.used_sources),
    reason: judged.judgement.reason,
    model,
    sources: graded(sources, answer.used_sources),
  };
}

function graded(
  sources: AssembledSource[],
  usedPaths: string[],
): GradedSource[] {
  return sources.map((source) => ({
    ...source,
    used: usedPaths.includes(source.path),
  }));
}

async function answerFromContext(
  llm: LlmProvider,
  { question, assembled }: Attempt,
): Promise<{ parsed: Answer; model: string }> {
  const { parsed, model } = await llm.completeWithTool<Answer>({
    systemPrompt: ANSWER_SYSTEM,
    prompt: `Context:\n\n${assembled.text}\n\nQuestion: ${question}`,
    toolName: "answer",
    toolDescription: "The answer and the sources it relied on",
    toolSchema: ANSWER_SCHEMA,
    jobName: JOB_NAME,
    temperature: 0,
  });

  return { parsed, model };
}

async function judgeAnswer(
  { llm, judgeModel }: EvalDeps,
  { document, question }: Attempt,
  answer: string,
): Promise<{ judgement: Judgement }> {
  const { parsed } = await llm.completeWithTool<Judgement>({
    ...(judgeModel ? { model: judgeModel } : {}),
    systemPrompt: JUDGE_SYSTEM,
    prompt: `Reference document:\n\n${document}\n\nQuestion: ${question}\n\nAnswer to compare: ${answer}`,
    toolName: "judgement",
    toolDescription:
      "Whether the answer addresses the question, and the sentence of the reference it contradicts, if any",
    toolSchema: JUDGEMENT_SCHEMA,
    jobName: JOB_NAME,
    temperature: 0,
  });

  return { judgement: parsed };
}

/** An answer passes when it addresses the question and contradicts nothing the document says. A contradiction counts only when the sentence the judge quotes is in the document and the judge says the two cannot both hold: a judge that fails an answer for detail the document lacks has nothing there to quote. */
export function passes(judgement: Judgement, document: string): boolean {
  const quoted = flattened(judgement.contradicted_sentence ?? "");

  const contradicts =
    quoted.length > 0 &&
    flattened(document).includes(quoted) &&
    judgement.both_can_hold !== true;

  return judgement.addresses_question && !contradicts;
}

function flattened(text: string): string {
  return text.toLowerCase().replaceAll(/\s+/g, " ").trim();
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
