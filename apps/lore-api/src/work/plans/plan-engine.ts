import type { RefineRequest } from "./plan-briefs.js";
import type { ApprovalDecision, PlanRef } from "./planning-line.js";

/** A plan as the routes hold it. */
export type PlanSubject = PlanRef & { status: string };

/** The drafting route's body. */
export interface DraftingRequest {
  known: string;
  createdBy: string;
  /** The issue number of the user story the plan answers, carried on its planning run. */
  storyIssue?: number;
}

/** What the plan routes ask of a plan's planning line, the same whichever engine holds it. Each verb answers what its route answers: a run or task id, or nothing. */
export interface PlanVerbs {
  draft(plan: PlanSubject, request: DraftingRequest): Promise<string>;
  refine(plan: PlanSubject, request: RefineRequest): Promise<void>;
  approvalDecision(plan: PlanSubject): Promise<ApprovalDecision>;
  handOverApproved(plan: PlanSubject, approvedBy: string): Promise<void>;
  reopen(plan: PlanSubject, actor: string): Promise<void>;
  openForAuthor(
    plan: PlanSubject,
    reopen: (planId: string) => Promise<unknown>,
  ): Promise<boolean>;
  startSpecWork(plan: PlanSubject, createdBy: string): Promise<string>;
  reworkSpec(plan: PlanSubject, actor: string): Promise<string>;
  validate(plan: PlanSubject, actor: string): Promise<string>;
}

/** The verbs that hand the plan's content to its line; the rest only read where the line is and report to it. */
export type PlanContentVerbs = Pick<
  PlanVerbs,
  "draft" | "refine" | "handOverApproved" | "startSpecWork"
>;
