import { enforceTrue } from "../lib/enforce.js";
/**
 * Untrusted-input guards for the feature-planning HTTP routes. `enforceFeatureInput`
 * is the bouncer for create/split (trim + non-empty + length); `parseSectionAnswers`
 * tolerantly normalizes a refinement round's `user_answers` instead of casting it
 * through unchecked. A {@link ValidationError} is a client fault the route maps to 400,
 * distinct from the unexpected-throw → 500 catch-all.
 */

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

/**
 * Tolerantly normalize an untrusted `user_answers` payload into {@link SectionAnswers},
 * or null when nothing usable is present. Drops non-string comments/answers and any
 * direction outside the allowed set — a malformed payload weakens the round, never throws.
 */
export function parseSectionAnswers(raw: unknown): SectionAnswers | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const sections: SectionAnswers["sections"] = {};

  if (isPlainObject(raw.sections)) {
    for (const [key, val] of Object.entries(raw.sections)) {
      if (!isPlainObject(val)) {
        continue;
      }
      const entry: { comment?: string; direction?: SectionDirection } = {};

      if (typeof val.comment === "string") {
        entry.comment = val.comment;
      }

      if (typeof val.direction === "string" && DIRECTIONS.has(val.direction)) {
        entry.direction = val.direction as SectionDirection;
      }
      sections[key] = entry;
    }
  }

  const questions: Record<string, string> = {};

  if (isPlainObject(raw.questions)) {
    for (const [key, val] of Object.entries(raw.questions)) {
      if (typeof val === "string") {
        questions[key] = val;
      }
    }
  }

  const free_form = typeof raw.free_form === "string" ? raw.free_form : "";

  if (
    !Object.keys(sections).length &&
    !Object.keys(questions).length &&
    !free_form
  ) {
    return null;
  }

  return { sections, questions, free_form };
}
