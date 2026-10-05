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
  /^(?:#?(?<bare>\d+)|https:\/\/github\.com\/(?<urlRepo>[^/\s]+\/[^/\s]+)\/issues\/(?<url>\d+)\/?)$/;

const STORY_REFUSED =
  "The user story must be a GitHub issue URL or its number.";

export type StoryIssue = { issue: number } | { error: string };

/** The issue number a user story names, as `#N`, a bare number or an issue URL of the plan's own repo. The run keeps only the number, so an issue of another repo would be linked as that number of this one: it is refused. */
export function storyIssueOf(text: string, repo: string): StoryIssue {
  const { issue, urlRepo } = storyPartsOf(text);

  if (issue <= 0) {
    return { error: STORY_REFUSED };
  }

  return isOtherRepo(urlRepo, repo)
    ? { error: `The user story must be an issue of ${repo}.` }
    : { issue };
}

interface StoryGroups {
  bare?: string;
  url?: string;
  urlRepo?: string;
}

// The issue number a story names, 0 for none, and the repo its URL names.
function storyPartsOf(text: string): { issue: number; urlRepo?: string } {
  const groups: StoryGroups = STORY_ISSUE.exec(text.trim())?.groups ?? {};

  return {
    issue: Number(groups.bare ?? groups.url ?? 0),
    urlRepo: groups.urlRepo,
  };
}

function isOtherRepo(urlRepo: string | undefined, repo: string): boolean {
  return urlRepo !== undefined && urlRepo.toLowerCase() !== repo.toLowerCase();
}

const isPlanKind = (type: string): type is PlanKind =>
  (PLAN_KINDS as readonly string[]).includes(type);

/** The new-plan form of a plan of `repo` (owner/name), or what is wrong with it. */
export function newPlanInput(
  formData: FormData,
  repo: string,
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
    repo,
  );
}

// A blank story is no story; one that names no issue is refused rather than dropped.
function withStory(
  input: NewPlanInput,
  story: string,
  repo: string,
): NewPlanInput | { error: string } {
  if (!story) {
    return input;
  }
  const read = storyIssueOf(story, repo);

  return "error" in read ? read : { ...input, storyIssue: read.issue };
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
