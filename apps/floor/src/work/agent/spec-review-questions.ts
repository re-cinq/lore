// Where the spec writer's questions land on the plan, and which questions it owes but never wrote (specs/7-feature-planning, "Rework from the spec review"). planning-document applies an `add-question` op by section slot and leaves the plan untouched when no section has that slot — the first rework on Otto #261 named four slots of its own and four questions vanished while their PR replies said "sent to the plan". Pure; the reads are the caller's.

import type { ReviewComment } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { SpecReviewResult } from "@re-cinq/lore-shared/review/spec-review.js";
import type { PlanSection } from "../../domain/plan-writer.js";

export type PlanQuestion = SpecReviewResult["plan_questions"][number];

/** The plan template's own section for what nobody has decided yet. */
export const OPEN_QUESTIONS_SLOT = "questions";

/** A question with the slot it lands on, and whether that differs from the one the writer named. */
export interface HomedQuestion {
  question: PlanQuestion;
  rehomed: boolean;
}

/** Every question on a slot the plan has: its own when the plan has it, the section whose title (or title-shaped slot) it named, else the plan's open-questions section or its last one. A plan with no readable sections keeps every slot as written. */
export function homeQuestions(
  questions: readonly PlanQuestion[],
  sections: readonly PlanSection[],
): HomedQuestion[] {
  return questions.map((question) => {
    const slot = homeSlot(question.slot, sections);

    return {
      question: slot === question.slot ? question : { ...question, slot },
      rehomed: slot !== question.slot,
    };
  });
}

function homeSlot(slot: string, sections: readonly PlanSection[]): string {
  if (
    sections.length === 0 ||
    sections.some((section) => section.slot === slot)
  ) {
    return slot;
  }
  const named = sections.find((section) => sameName(section.title, slot));

  return named?.slot ?? fallbackSlot(sections);
}

/** "Delivery implications", "delivery-implications" and "delivery_implications" name the same section. */
function sameName(title: string, slot: string): boolean {
  return normalizeName(title) === normalizeName(slot);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fallbackSlot(sections: readonly PlanSection[]): string {
  const open = sections.find((section) => section.slot === OPEN_QUESTIONS_SLOT);

  return (open ?? sections[sections.length - 1]).slot;
}

/** The questions the writer owes: one per `to_plan` reply whose comment no question of its own answers for, made from the comment so the reply's "sent to the plan" is true. */
export function questionsOwed(
  result: SpecReviewResult,
  comments: readonly ReviewComment[],
): PlanQuestion[] {
  const asked = new Set(
    result.plan_questions.map((question) => question.comment_id),
  );

  const owed = result.replies.filter(
    (reply) => reply.action === "to_plan" && !asked.has(reply.comment_id),
  );

  return owed.map((reply) =>
    questionFromComment(
      reply.comment_id,
      comments.find((comment) => comment.id === reply.comment_id),
    ),
  );
}

const QUESTION_LEAD_MAX = 200;

function questionFromComment(
  commentId: number,
  comment: ReviewComment | undefined,
): PlanQuestion {
  const where = comment ? ` on ${comment.path}` : "";
  const lead = comment ? `: ${firstLine(comment.body)}` : "";

  return {
    slot: OPEN_QUESTIONS_SLOT,
    question: `Review comment ${commentId}${where} asks for a decision the plan has not made${lead}`,
    why: comment?.body ?? "",
    comment_id: commentId,
  };
}

function firstLine(body: string): string {
  const line = body.split("\n").find((candidate) => candidate.trim()) ?? "";
  const plain = line.replace(/\*\*/g, "").trim();

  return plain.length > QUESTION_LEAD_MAX
    ? `${plain.slice(0, QUESTION_LEAD_MAX - 1)}…`
    : plain;
}
