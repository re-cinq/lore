import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { IssueRef } from "@re-cinq/lore-shared";
import type { PlanStories, SavedStory } from "./plan-stories.js";

/** The one rule for which user story a plan has: what a person saved on the plan wins, a removal included, and a plan nobody saved a story on keeps the one its newest run carries. */
export function storyOf(
  saved: SavedStory | undefined,
  runStory: number | null | undefined,
): number | null {
  return saved ? saved.issueNumber : (runStory ?? null);
}

export interface PlanStoryPorts {
  plan(planId: string): Promise<{ id: string; repo: string } | null>;
  stories: PlanStories;
  /** The user story the plan's newest run carries, null when it names none or nothing ran. */
  runStory(plan: { id: string; repo: string }): Promise<number | null>;
}

export interface PlanStoryView {
  issueNumber: number | null;
  issueUrl: string | null;
}

export async function readPlanStory(
  planId: string,
  ports: PlanStoryPorts,
): Promise<PlanStoryView> {
  const plan = await knownPlan(planId, ports);

  return viewOf(plan.repo, await currentStory(plan, ports));
}

/** Saves only a story that differs from the plan's current one, so a station that reports the same story again changes nothing. */
export async function savePlanStory(
  planId: string,
  { issueNumber, setBy }: { issueNumber: number | null; setBy: string },
  ports: PlanStoryPorts,
): Promise<PlanStoryView> {
  const plan = await knownPlan(planId, ports);
  const current = await currentStory(plan, ports);

  if (current !== issueNumber) {
    await ports.stories.save({ planId: plan.id, issueNumber, setBy });
  }

  return viewOf(plan.repo, issueNumber);
}

async function knownPlan(planId: string, ports: PlanStoryPorts) {
  const plan = await ports.plan(planId);

  enforceTrue(plan, apiError(404), "plan not found");

  return plan;
}

async function currentStory(
  plan: { id: string; repo: string },
  ports: PlanStoryPorts,
): Promise<number | null> {
  const [saved, runStory] = await Promise.all([
    ports.stories.saved(plan.id),
    ports.runStory(plan),
  ]);

  return storyOf(saved, runStory);
}

function viewOf(repo: string, issueNumber: number | null): PlanStoryView {
  return {
    issueNumber,
    issueUrl: issueNumber === null ? null : issueUrlOf(repo, issueNumber),
  };
}

/** The plan's user story as its planning agents read it beside the plan; title, state and body are null when GitHub could not be read. */
export interface PlanStoryContext {
  number: number;
  url: string;
  title: string | null;
  state: string | null;
  body: string | null;
}

export type ReadIssue = (
  repo: string,
  number: number,
) => Promise<IssueRef | null>;

const MAX_STORY_CHARS = 8000;

/** The issue's own words, cut to what a prompt can carry. A failed GitHub read keeps the story's number and link, so reading the plan never fails on it. */
export async function planStoryContext(
  planId: string,
  ports: PlanStoryPorts,
  readIssue: ReadIssue,
): Promise<PlanStoryContext | null> {
  const plan = await knownPlan(planId, ports);
  const number = await currentStory(plan, ports);

  if (number === null) {
    return null;
  }
  const issue = await readIssue(plan.repo, number).catch(() => null);

  return { number, url: issueUrlOf(plan.repo, number), ...wordsOf(issue) };
}

function wordsOf(issue: IssueRef | null) {
  if (!issue) {
    return { title: null, state: null, body: null };
  }
  const body = issue.body ?? "";

  return {
    title: issue.title,
    state: issue.state,
    body: body.slice(0, MAX_STORY_CHARS),
  };
}

function issueUrlOf(repo: string, number: number): string {
  return `https://github.com/${repo}/issues/${number}`;
}
