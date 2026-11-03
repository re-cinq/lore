// The context builder: plans the task's questions, gathers the evidence that answers them, and has the model write the block from that evidence alone.

import type { LlmProvider } from "../../outbound/llm/llm-provider.js";
import { candidatePaths } from "./candidate-paths.js";
import { queryAnchors, type QueryAnchors } from "./query-anchors.js";
import {
  COMPOSE_SYSTEM,
  PICK_SYSTEM,
  PICK_TOOL,
  PLAN_SYSTEM,
  PLAN_TOOL,
  composePrompt,
  pickPrompt,
  planPrompt,
  type ContextPlan,
  type ContextTask,
  type FilePicks,
} from "./builder-prompts.js";

export interface ContextBuilderDeps {
  llm: LlmProvider;
  primer(): Promise<string>;
  tree(): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
  /** The repository's own assembly for a question: its docs, specs, code and memories. */
  answer(question: string, repo: string): Promise<string>;
  issue(number: number): Promise<string | null>;
  previousWork(terms: string[]): Promise<string[]>;
  relatedRepos(): Promise<string[]>;
}

export interface BuiltContext {
  text: string;
  evidence: Evidence;
}

interface Evidence {
  primer: string;
  answers: { question: string; answer: string }[];
  files: Record<string, string>;
  issues: string[];
  previous_work: string[];
  related_repos: Record<string, string>;
}

const MAX_FILES = 6;
const CANDIDATES = 300;
const MAX_FILE_CHARS = 15_000;
const MAX_EVIDENCE_CHARS = 150_000;
const COMPOSE_MAX_TOKENS = 4_000;

export async function buildContext(
  task: ContextTask,
  deps: ContextBuilderDeps,
): Promise<BuiltContext> {
  const anchors = queryAnchors(task.query);
  const plan = await planned(task, anchors, deps.llm);
  const evidence = await gathered(task, { anchors, plan }, deps);
  const related = Object.keys(evidence.related_repos);
  const written = await deps.llm.complete({
    systemPrompt: COMPOSE_SYSTEM,
    prompt: composePrompt(task, related, evidenceText(evidence)),
    maxTokens: COMPOSE_MAX_TOKENS,
    temperature: 0,
    jobName: "context-builder",
  });

  return { text: written.text.trim(), evidence };
}

async function planned(
  task: ContextTask,
  anchors: QueryAnchors,
  llm: LlmProvider,
): Promise<ContextPlan> {
  const { parsed } = await llm.completeWithTool<Partial<ContextPlan>>({
    ...PLAN_TOOL,
    systemPrompt: PLAN_SYSTEM,
    prompt: planPrompt(task, anchors),
    temperature: 0,
    jobName: "context-builder",
  });

  return {
    questions: parsed.questions ?? [],
    search_terms: parsed.search_terms ?? [],
  };
}

async function gathered(
  task: ContextTask,
  { anchors, plan }: { anchors: QueryAnchors; plan: ContextPlan },
  deps: ContextBuilderDeps,
): Promise<Evidence> {
  const [primer, files, searched] = await Promise.all([
    deps.primer(),
    openedFiles(task, { anchors, plan }, deps),
    searchedEvidence(task, { anchors, plan }, deps),
  ]);

  return { primer, files, ...searched };
}

async function searchedEvidence(
  task: ContextTask,
  { anchors, plan }: { anchors: QueryAnchors; plan: ContextPlan },
  deps: ContextBuilderDeps,
): Promise<Omit<Evidence, "primer" | "files">> {
  const [answers, issues, previous_work, related_repos] = await Promise.all([
    Promise.all(plan.questions.map((q) => answered(q, task.repo, deps))),
    namedIssues(anchors.numbers, deps),
    deps.previousWork([...plan.search_terms, ...anchors.requirements]),
    relatedAnswers(task.query, deps),
  ]);

  return { answers, issues, previous_work, related_repos };
}

async function answered(
  question: string,
  repo: string,
  deps: ContextBuilderDeps,
) {
  return { question, answer: await deps.answer(question, repo) };
}

async function openedFiles(
  task: ContextTask,
  { anchors, plan }: { anchors: QueryAnchors; plan: ContextPlan },
  deps: ContextBuilderDeps,
): Promise<Record<string, string>> {
  const tree = await deps.tree();
  const candidates = candidatePaths(tree, {
    text: [task.query, ...plan.questions].join(" "),
    named: anchors.paths,
    limit: CANDIDATES,
  });
  const picks = await pickedFiles(task, plan.questions, candidates, deps.llm);
  const held = new Set(tree);
  const chosen = [...new Set(picks.filter((path) => held.has(path)))].slice(
    0,
    MAX_FILES,
  );

  return readAll(chosen, deps);
}

async function pickedFiles(
  task: ContextTask,
  questions: string[],
  candidates: string[],
  llm: LlmProvider,
): Promise<string[]> {
  const { parsed } = await llm.completeWithTool<Partial<FilePicks>>({
    ...PICK_TOOL,
    systemPrompt: PICK_SYSTEM,
    prompt: pickPrompt(task, questions, candidates),
    temperature: 0,
    jobName: "context-builder",
  });

  return parsed.files ?? [];
}

async function readAll(
  paths: string[],
  deps: ContextBuilderDeps,
): Promise<Record<string, string>> {
  const contents = await Promise.all(paths.map((path) => deps.readFile(path)));

  return Object.fromEntries(
    paths.flatMap((path, index) => {
      const content = contents[index];

      return content === null ? [] : [[path, content.slice(0, MAX_FILE_CHARS)]];
    }),
  );
}

async function namedIssues(
  numbers: number[],
  deps: ContextBuilderDeps,
): Promise<string[]> {
  const texts = await Promise.all(numbers.map((number) => deps.issue(number)));

  return texts.filter((text): text is string => text !== null);
}

async function relatedAnswers(
  query: string,
  deps: ContextBuilderDeps,
): Promise<Record<string, string>> {
  const repos = await deps.relatedRepos();
  const answers = await Promise.all(
    repos.map((repo) => deps.answer(query, repo)),
  );

  return Object.fromEntries(repos.map((repo, index) => [repo, answers[index]]));
}

function evidenceText(evidence: Evidence): string {
  return JSON.stringify(evidence, null, 1).slice(0, MAX_EVIDENCE_CHARS);
}
