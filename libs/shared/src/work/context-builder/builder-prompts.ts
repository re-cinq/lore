// What the builder asks its model: the task's questions, the files worth opening, and the block written from the gathered evidence alone.

import type { QueryAnchors } from "./query-anchors.js";

export interface ContextTask {
  query: string;
  repo: string;
  maxTokens: number;
}

export interface ContextPlan {
  questions: string[];
  search_terms: string[];
}

export interface FilePicks {
  files: string[];
}

const MAX_WORDS = 900;
const WORDS_PER_TOKEN = 0.7;
const WRITING_TASK_RE =
  /\b(digest|changelog|release notes|document|documentation|report|runbook)\b/i;

export const PLAN_TOOL = {
  toolName: "plan_context",
  toolDescription: "The questions to answer before the task starts.",
  toolSchema: {
    type: "object",
    properties: {
      questions: { type: "array", items: { type: "string" } },
      search_terms: { type: "array", items: { type: "string" } },
    },
    required: ["questions", "search_terms"],
  },
};

export const PICK_TOOL = {
  toolName: "pick_files",
  toolDescription: "The repository files worth reading for the task.",
  toolSchema: {
    type: "object",
    properties: { files: { type: "array", items: { type: "string" } } },
    required: ["files"],
  },
};

export const PLAN_SYSTEM =
  "You plan what an AI coding agent must know before it starts a task in a repository.";

export function planPrompt(task: ContextTask, anchors: QueryAnchors): string {
  return [
    `Repository: ${task.repo}`,
    `Task: ${task.query}`,
    `It names: ${JSON.stringify(anchors)}`,
    "",
    "Write 3 to 5 factual questions a search of this repository's specs, ADRs, code, tickets and past sessions can answer:",
    "where something is, what a spec requires, what earlier work on the topic decided. No judgement calls, no speculation.",
    "Also give 2 to 4 short search terms (2 to 4 words each) that find earlier issues, pull requests and sessions on the topic.",
  ].join("\n");
}

export const PICK_SYSTEM =
  "You pick which repository files an AI coding agent should read before a task.";

export function pickPrompt(task: ContextTask, candidates: string[]): string {
  return [
    `Task: ${task.query}`,
    "",
    "Candidate files (real paths):",
    ...candidates,
    "",
    "Give up to 6 paths from the list whose content best tells an agent what it must know for the task: source files, specs, ADRs, workflows.",
  ].join("\n");
}

export const COMPOSE_SYSTEM = [
  "You write the context block an AI coding agent reads before it starts a task.",
  "Use only the evidence given. Cite every fact with its source: a file, spec, ADR, issue or pull request number, or memory key.",
  "Never invent a path, number, date or tool. Never state a relationship the evidence does not state",
  "(one ticket superseding another, a pull request being the base of a change): leave it out or mark it (inferred).",
  "Evidence about a repository that is neither the task's nor one it depends on is left out.",
  "The reader has the task text: never restate the task, its acceptance criteria, its references or the issue it came from,",
  "and never copy a section of it (Implements, Acceptance criteria, How to test, References, Related, Context, Needs a person).",
].join(" ");

export function composePrompt(
  task: ContextTask,
  related: string[],
  evidence: string,
): string {
  return [
    `Task: ${task.query}`,
    `Repository: ${task.repo} (depends on: ${related.join(", ") || "none"})`,
    "",
    "Evidence:",
    evidence,
    "",
    ...composeFormat(task),
  ].join("\n");
}

function composeFormat(task: ContextTask): string[] {
  return [
    "Write markdown with exactly these four sections and no other, nothing before the first and nothing after the last:",
    "## Key facts — only the questions the evidence answers, each in bold with a 1 to 3 sentence answer and its citations.",
    "When an answer rests on a spec requirement, an ADR or a stated rule, quote its sentence (at most 40 words).",
    "A question the evidence does not answer is left out without a word about it.",
    "## Where to look — the specs, files (with line ranges where the evidence shows them) and tests the task touches,",
    "one line each: the path and why it matters. No instructions on how to open it.",
    "## Previous work — one line per related issue, pull request, commit or session: what it was, its outcome, the lesson.",
    ...examplesAsk(task.query),
    "## Repo primer — the primer as given.",
    `Keep the block under ${blockWords(task.maxTokens)} words.`,
  ];
}

/** The ask for earlier outputs, for a task that writes something; nothing for any other. */
function examplesAsk(query: string): string[] {
  return writesSomething(query)
    ? [
        "The task writes something: add one or two earlier outputs of that kind, quoted briefly, as examples of format and voice.",
      ]
    : [];
}

/** Whether the task produces a text (a digest, a changelog, a document) whose earlier instances show its format and voice. */
export function writesSomething(query: string): boolean {
  return WRITING_TASK_RE.test(query);
}

function blockWords(maxTokens: number): number {
  return Math.min(MAX_WORDS, Math.floor(maxTokens * WORDS_PER_TOKEN));
}
