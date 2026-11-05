// The context builder: plans the task's questions, gathers the evidence that answers them, and has the model write the block from that evidence alone.

import type { LlmProvider } from "../../outbound/llm/llm-provider.js";
import { candidatePaths } from "./candidate-paths.js";
import { linesAround, relevantSlice } from "./file-slice.js";
import {
  queryAnchors,
  type LinkedLine,
  type QueryAnchors,
} from "./query-anchors.js";
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

/** A fragment of code a text search found, with the file holding it. */
export interface CodeHit {
  path: string;
  text: string;
}

export interface ContextBuilderDeps {
  llm: LlmProvider;
  primer(): Promise<string>;
  tree(): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
  /** The lines of the repository's code holding a term, so a fact in a string literal is found without its path. */
  grep(term: string): Promise<CodeHit[]>;
  /** The repository's own assembly for a question: its docs, specs, code and memories. */
  answer(question: string, repo: string): Promise<string>;
  issue(number: number): Promise<string | null>;
  previousWork(terms: string[]): Promise<string[]>;
  relatedRepos(): Promise<string[]>;
}

export interface BuiltContext {
  text: string;
  evidence: Evidence;
  /** Milliseconds each stage took, so a slow build names its stage. */
  stages: Record<string, number>;
}

interface Evidence {
  primer: string;
  answers: { question: string; answer: string }[];
  files: Record<string, string>;
  linked: { path: string; line: number | null; text: string }[];
  grep: CodeHit[];
  issues: string[];
  previous_work: string[];
  related_repos: Record<string, string>;
}

const MAX_FILES = 6;
const LINK_RADIUS = 15;
const CANDIDATES = 300;
const MAX_FILE_CHARS = 6_000;
const MAX_EVIDENCE_CHARS = 150_000;
/** Room for a 900-word block and little more: a write-up that runs on past it is cut, not waited for (8 of 16 builds on 2026-11-05 ran out the 90 s call timeout in the write-up). */
const COMPOSE_MAX_TOKENS = 2_000;
const MAX_GREP_TERMS = 4;
const MAX_HITS_PER_TERM = 5;

export async function buildContext(
  task: ContextTask,
  deps: ContextBuilderDeps,
): Promise<BuiltContext> {
  const anchors = queryAnchors(task.query);
  const stages: Record<string, number> = {};
  const [plan, picks] = await timed(stages, "plan", () =>
    Promise.all([
      planned(task, anchors, deps.llm),
      pickedPaths(task, anchors, deps),
    ]),
  );
  const evidence = await timed(stages, "evidence", () =>
    gathered(task, { anchors, plan, picks }, deps),
  );
  const text = await timed(stages, "compose", () =>
    composed(task, evidence, deps.llm),
  );

  return { text, evidence, stages };
}

async function composed(
  task: ContextTask,
  evidence: Evidence,
  llm: LlmProvider,
): Promise<string> {
  const related = Object.keys(evidence.related_repos);
  const written = await llm.complete({
    systemPrompt: COMPOSE_SYSTEM,
    prompt: composePrompt(task, related, evidenceText(evidence)),
    maxTokens: COMPOSE_MAX_TOKENS,
    temperature: 0,
    jobName: "context-builder",
  });

  return written.text.trim();
}

async function timed<T>(
  stages: Record<string, number>,
  stage: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const result = await run();

  stages[stage] = Date.now() - started;

  return result;
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

interface Gathering {
  anchors: QueryAnchors;
  plan: ContextPlan;
  picks: string[];
}

async function gathered(
  task: ContextTask,
  { anchors, plan, picks }: Gathering,
  deps: ContextBuilderDeps,
): Promise<Evidence> {
  const words = [task.query, ...plan.questions].join(" ").split(/[^\w]+/);
  const [primer, files, linked, grep, searched] = await Promise.all([
    deps.primer(),
    readAll(picks, words, deps),
    linkedLines(anchors.links, words, deps),
    searchedCode([...anchors.literals, ...plan.search_terms], deps),
    searchedEvidence(task, { anchors, plan }, deps),
  ]);

  return { primer, files, linked, grep, ...searched };
}

async function searchedEvidence(
  task: ContextTask,
  { anchors, plan }: { anchors: QueryAnchors; plan: ContextPlan },
  deps: ContextBuilderDeps,
): Promise<Omit<Evidence, "primer" | "files" | "linked" | "grep">> {
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

/** The real paths the model picks for the task, from the ones the query names and the ones sharing its words, beside the planning rather than after it. */
async function pickedPaths(
  task: ContextTask,
  anchors: QueryAnchors,
  deps: ContextBuilderDeps,
): Promise<string[]> {
  const tree = await deps.tree();
  const candidates = candidatePaths(tree, {
    text: task.query,
    named: anchors.paths,
    limit: CANDIDATES,
  });
  const picks = await pickedFiles(task, candidates, deps.llm);
  const held = new Set(tree);

  const linked = new Set(anchors.links.map((link) => link.path));

  return [
    ...new Set(picks.filter((path) => held.has(path) && !linked.has(path))),
  ].slice(0, MAX_FILES);
}

async function pickedFiles(
  task: ContextTask,
  candidates: string[],
  llm: LlmProvider,
): Promise<string[]> {
  const { parsed } = await llm.completeWithTool<Partial<FilePicks>>({
    ...PICK_TOOL,
    systemPrompt: PICK_SYSTEM,
    prompt: pickPrompt(task, candidates),
    temperature: 0,
    jobName: "context-builder",
  });

  return parsed.files ?? [];
}

async function readAll(
  paths: string[],
  words: string[],
  deps: ContextBuilderDeps,
): Promise<Record<string, string>> {
  const contents = await Promise.all(paths.map((path) => deps.readFile(path)));

  return Object.fromEntries(
    paths.flatMap((path, index) => {
      const content = contents[index];

      return content === null
        ? []
        : [[path, relevantSlice(content, words, MAX_FILE_CHARS)]];
    }),
  );
}

/** What each linked file holds around the line the task's link names, else the part matching the task's words; an unreadable file is dropped. */
async function linkedLines(
  links: LinkedLine[],
  words: string[],
  deps: ContextBuilderDeps,
): Promise<Evidence["linked"]> {
  const contents = await Promise.all(
    links.map((link) => deps.readFile(link.path)),
  );

  return links.flatMap(({ path, line }, index) => {
    const content = contents[index];

    if (content === null) {
      return [];
    }
    const text =
      line === null
        ? relevantSlice(content, words, MAX_FILE_CHARS)
        : linesAround(content, line, LINK_RADIUS);

    return [{ path, line, text }];
  });
}

/** The code lines holding the query's literals and the plan's search terms, a few per term; a search that fails finds nothing. */
async function searchedCode(
  terms: string[],
  deps: ContextBuilderDeps,
): Promise<CodeHit[]> {
  const searched = [...new Set(terms)].slice(0, MAX_GREP_TERMS);
  const hits = await Promise.all(
    searched.map((term) =>
      deps
        .grep(term)
        .then((found) => found.slice(0, MAX_HITS_PER_TERM))
        .catch((): CodeHit[] => []),
    ),
  );

  return hits.flat();
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
