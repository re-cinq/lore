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

/** The Lore tools an agent can open what the block points at with; the write-up names no other. */
export const LORE_READ_TOOLS = [
  "lore_search_context (passages of the repository's specs, ADRs and docs)",
  "lore_search_memory (past sessions, decisions and facts)",
  "lore-query-trace (a spec's statements with their tests and code)",
  "lore_get_ci_failures (what CI said about the branch)",
];

const MAX_WORDS = 900;
const WORDS_PER_TOKEN = 0.7;

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

export function pickPrompt(
  task: ContextTask,
  questions: string[],
  candidates: string[],
): string {
  return [
    `Task: ${task.query}`,
    "Questions:",
    ...questions.map((question) => `- ${question}`),
    "",
    "Candidate files (real paths):",
    ...candidates,
    "",
    "Give up to 6 paths from the list whose content best answers the questions: source files, specs, ADRs, workflows.",
  ].join("\n");
}

export const COMPOSE_SYSTEM = [
  "You write the context block an AI coding agent reads before it starts a task.",
  "Use only the evidence given. Cite every fact with its source: a file, spec, ADR, issue or pull request number, or memory key.",
  "Never invent a path, number, date or tool. Never state a relationship the evidence does not state",
  "(one ticket superseding another, a pull request being the base of a change): leave it out or mark it (inferred).",
  "Evidence about a repository that is neither the task's nor one it depends on is left out.",
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
    composeFormat(blockWords(task.maxTokens)),
  ].join("\n");
}

function composeFormat(words: number): string {
  return [
    "Write markdown with exactly these sections:",
    "## Repo primer — the primer as given.",
    "## Key facts — only the questions the evidence answers, each in bold with a 1 to 3 sentence answer and its citations.",
    "When an answer rests on a spec requirement, an ADR or a stated rule, quote its sentence (at most 40 words).",
    'Leave out the questions the evidence does not answer and name them on one closing line, "Unanswered: ...".',
    "## Where to look — the specs, files (with line ranges where the evidence shows them) and tests the task touches,",
    `each with why it matters and how to open it: read the file, or one of these tools: ${LORE_READ_TOOLS.join("; ")}.`,
    "## Previous work — one line per related issue, pull request, commit or session: what it was, its outcome, the lesson.",
    "When the task writes something (a digest, a changelog, a document), add one or two earlier outputs of that kind, quoted briefly, as examples of format and voice.",
    `Keep the block under ${words} words.`,
  ].join("\n");
}

function blockWords(maxTokens: number): number {
  return Math.min(MAX_WORDS, Math.floor(maxTokens * WORDS_PER_TOKEN));
}
