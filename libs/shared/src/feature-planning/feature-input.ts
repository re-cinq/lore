import { enforceTrue } from "../lib/enforce.js";
// Untrusted-input guards for the feature-planning HTTP routes; a {@link ValidationError} is a client fault the route maps to 400, distinct from the 500 catch-all.

import type { SectionAnswers } from "./planning-prompt.js";
import type { SectionDirection } from "./gap-result.js";

const TITLE_MAX = 256;
const PROMPT_MAX = 8000;
const DIRECTIONS: ReadonlySet<string> = new Set<SectionDirection>([
  "keep",
  "refine",
  "redirect",
]);

/** A client-input rejection the route maps to 400 (not the 500 catch-all). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface FeatureInput {
  title: string;
  prompt: string;
}

/** Enforce a non-empty, length-bounded title + prompt, trimming both. Throws ValidationError. */
export function enforceFeatureInput(
  title: unknown,
  prompt: unknown,
): FeatureInput {
  const t = typeof title === "string" ? title.trim() : "";
  const p = typeof prompt === "string" ? prompt.trim() : "";

  enforceTrue(!(!t || !p), ValidationError, "title and prompt are required");
  enforceTrue(
    t.length <= TITLE_MAX,
    ValidationError,
    `title must be ${TITLE_MAX} characters or fewer`,
  );
  enforceTrue(
    p.length <= PROMPT_MAX,
    ValidationError,
    `prompt must be ${PROMPT_MAX} characters or fewer`,
  );

  return { title: t, prompt: p };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSectionEntry(section: Record<string, unknown>): {
  comment?: string;
  direction?: SectionDirection;
} {
  const entry: { comment?: string; direction?: SectionDirection } = {};

  if (typeof section.comment === "string") {
    entry.comment = section.comment;
  }

  if (
    typeof section.direction === "string" &&
    DIRECTIONS.has(section.direction)
  ) {
    entry.direction = section.direction as SectionDirection;
  }

  return entry;
}

type SectionAnswerEntries = NonNullable<SectionAnswers["sections"]>;

function normalizeSections(raw: unknown): SectionAnswerEntries {
  const sections: SectionAnswerEntries = {};
  const rawSections = isPlainObject(raw) ? raw : {};

  for (const [key, section] of Object.entries(rawSections)) {
    if (isPlainObject(section)) {
      sections[key] = normalizeSectionEntry(section);
    }
  }

  return sections;
}

function normalizeQuestions(raw: unknown): Record<string, string> {
  const questions: Record<string, string> = {};
  const rawQuestions = isPlainObject(raw) ? raw : {};

  for (const [key, question] of Object.entries(rawQuestions)) {
    if (typeof question === "string") {
      questions[key] = question;
    }
  }

  return questions;
}

function isEmptyAnswers(
  sections: SectionAnswerEntries,
  questions: Record<string, string>,
  free_form: string,
): boolean {
  return (
    !Object.keys(sections).length &&
    !Object.keys(questions).length &&
    !free_form
  );
}

// Tolerantly normalizes an untrusted `user_answers` payload into {@link SectionAnswers} (or null) — a malformed payload weakens the round, never throws.
export function parseSectionAnswers(raw: unknown): SectionAnswers | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const sections = normalizeSections(raw.sections);
  const questions = normalizeQuestions(raw.questions);
  const free_form = typeof raw.free_form === "string" ? raw.free_form : "";

  if (isEmptyAnswers(sections, questions, free_form)) {
    return null;
  }

  return { sections, questions, free_form };
}
