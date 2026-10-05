import { PLAN_KINDS, type PlanKind } from "@re-cinq/planning-document";

/** What the new-plan form asks for: a title, a template, and what the author already knows. */
export interface NewPlanInput {
  title: string;
  type: PlanKind;
  description: string;
  /** The issue number of the user story the plan answers, when the author names one. */
  storyIssue?: number;
}

const STORY_ISSUE =
  /^(?:#?(\d+)|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)\/?)$/;

const STORY_REFUSED =
  "The user story must be a GitHub issue URL or its number.";

/** The issue number a user story names, as a GitHub issue URL, `#N` or a bare number; null for anything else. */
export function storyIssueOf(text: string): number | null {
  const match = STORY_ISSUE.exec(text.trim());
  const issue = Number(match?.[1] ?? match?.[2] ?? 0);

  return issue > 0 ? issue : null;
}

const isPlanKind = (type: string): type is PlanKind =>
  (PLAN_KINDS as readonly string[]).includes(type);

export function newPlanInput(
  formData: FormData,
): NewPlanInput | { error: string } {
  const title = field(formData, "title");
  const type = field(formData, "type");

  if (!title) {
    return { error: "A plan needs a title." };
  }

  if (!isPlanKind(type)) {
    return { error: `Unknown plan type ${type}.` };
  }

  return withStory(
    { title, type, description: field(formData, "description") },
    field(formData, "story"),
  );
}

// A blank story is no story; one that names no issue is refused rather than dropped.
function withStory(
  input: NewPlanInput,
  story: string,
): NewPlanInput | { error: string } {
  if (!story) {
    return input;
  }
  const storyIssue = storyIssueOf(story);

  return storyIssue ? { ...input, storyIssue } : { error: STORY_REFUSED };
}

/** The description's paragraphs, as the plan's intent section holds them. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function field(formData: FormData, key: string): string {
  const raw = formData.get(key);

  return typeof raw === "string" ? raw.trim() : "";
}
