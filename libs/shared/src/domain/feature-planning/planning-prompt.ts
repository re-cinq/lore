import {
  type GapResult,
  type GapSection,
  type GapQuestion,
  type SectionDirection,
  sectionsOf,
} from "./gap-result.js";

/** Author feedback for planning round: per-section comment+direction, question answers, free-form note (mirrors UI FeedbackState). */
export interface SectionAnswers {
  sections?: Record<string, { comment?: string; direction?: SectionDirection }>;
  questions?: Record<string, string>;
  free_form?: string;
}

export interface PlanningPromptInput {
  /** The feature title. */
  title: string;
  /** The feature's original request. */
  originalPrompt: string;
  /** The most recent ready round's result — rendered as the <Generated> context. */
  priorGap: GapResult | null;
  /** The author's feedback for this round. */
  answers: SectionAnswers | null;
}

export interface RoundFeedbackInput {
  /** Which round this is, 1-based — the agent uses it to know it is refining. */
  round: number;
  /** The round being reacted to, read only for its section and question TEXT. */
  priorGap: GapResult | null;
  answers: SectionAnswers | null;
}

type SectionFeedback = { comment?: string; direction?: SectionDirection };

/** Build per-round planning prompt as XML-tagged context; Round 1 is Title+UserPrompt, refinement rounds add CurrentDraftSpec. */
export function composePlanningPrompt(input: PlanningPromptInput): string {
  const blocks = [
    tag("Title", input.title),
    tag("UserPrompt", input.originalPrompt),
  ];
  const draftSpec = currentDraftSpec(input.priorGap, input.answers);

  if (draftSpec) {
    blocks.push(draftSpec);
  }

  return blocks.join("\n\n");
}

/** Turn for round CONTINUING previous conversation; only new feedback (omits untouched sections); pairs with composePlanningPrompt(). */
export function composeRoundFeedback(input: RoundFeedbackInput): string {
  const { answers } = input;
  const touched = sectionsOf(input.priorGap)
    .map((section) => feedbackBlock(section, answers))
    .filter((block): block is string => block !== null);
  const note = answers?.free_form?.trim();

  if (note) {
    touched.push(tag("OtherUserComments", note));
  }

  const body = touched.length ? `${touched.join("\n")}\n` : "";

  return `<RoundFeedback round="${input.round}">\n${body}</RoundFeedback>`;
}

function currentDraftSpec(
  gap: GapResult | null,
  answers: SectionAnswers | null,
): string | null {
  const sections = sectionsOf(gap);
  const otherComments = freeFormBlock(answers);

  if (!sections.length) {
    return otherComments;
  }
  const inner = sections.map((s) => sectionBlock(s, answers));

  if (otherComments) {
    inner.push(otherComments);
  }

  return tag("CurrentDraftSpec", inner.join("\n\n"));
}

/** One section's feedback, or null when the author said nothing about it. */
function feedbackBlock(
  section: GapSection,
  answers: SectionAnswers | null,
): string | null {
  const feedback = sectionFeedback(section, answers);
  const answered = answeredQuestions(section, feedback, answers);

  if (!feedback && !answered.length) {
    return null;
  }
  const title = section.title.replace(/"/g, "'");
  const parts = feedbackParts(sectionComment(feedback), answered, answers);

  return renderFeedbackSection(title, sectionDirection(feedback), parts);
}

function freeFormBlock(answers: SectionAnswers | null): string | null {
  const note = answers?.free_form?.trim();

  return note ? tag("OtherUserComments", note) : null;
}

function sectionBlock(
  section: GapSection,
  answers: SectionAnswers | null,
): string {
  const parts = [tag("Generated", generatedContent(section))];

  if (section.questions?.length) {
    parts.push(questionsBlock(section.questions, answers));
  }
  const commentBlock = sectionCommentBlock(section, answers);

  if (commentBlock) {
    parts.push(commentBlock);
  }

  return renderSection(section.title, parts);
}

function answeredQuestions(
  section: GapSection,
  feedback: SectionFeedback | undefined,
  answers: SectionAnswers | null,
): GapQuestion[] {
  const questions = answers?.questions;

  return (section.questions ?? []).filter(
    (q) => feedback || questions?.[q.id]?.trim(),
  );
}

function feedbackParts(
  comment: string | undefined,
  answered: GapQuestion[],
  answers: SectionAnswers | null,
): string[] {
  const parts: string[] = [];

  if (comment) {
    parts.push(tag("UserComment", comment));
  }

  for (const question of answered) {
    parts.push(questionTag(question, answers));
  }

  return parts;
}

function sectionDirection(
  feedback: SectionFeedback | undefined,
): SectionDirection {
  return feedback?.direction ?? "refine";
}

function renderFeedbackSection(
  title: string,
  direction: SectionDirection,
  parts: string[],
): string {
  return parts.length
    ? `<Section title="${title}" direction="${direction}">\n${parts.join("\n")}\n</Section>`
    : `<Section title="${title}" direction="${direction}"/>`;
}

function generatedContent(section: GapSection): string {
  const parts: string[] = [];

  if (section.content?.trim()) {
    parts.push(section.content.trim());
  }

  const { mockups } = section;

  if (mockups?.length) {
    const titles = mockups.map((m, i) => m.title || `Mockup ${i + 1}`);

    parts.push(`Diagrams: ${titles.join(", ")}`);
  }

  return parts.join("\n\n") || "(no content)";
}

function questionsBlock(
  questions: GapQuestion[],
  answers: SectionAnswers | null,
): string {
  const body = questions.map((q) => questionTag(q, answers)).join("\n");

  return tag("Questions", body);
}

function sectionCommentBlock(
  section: GapSection,
  answers: SectionAnswers | null,
): string | null {
  const feedback = sectionFeedback(section, answers);

  return hasCommentOrDirection(feedback) ? renderUserComment(feedback) : null;
}

function renderSection(title: string, parts: string[]): string {
  return `<Section title="${title.replace(/"/g, "'")}">\n${parts.join("\n")}\n</Section>`;
}

function hasCommentOrDirection(feedback: SectionFeedback | undefined): boolean {
  return Boolean(feedback?.comment?.trim()) || Boolean(feedback?.direction);
}

function renderUserComment(feedback: SectionFeedback | undefined): string {
  const direction = feedback?.direction ?? "keep";
  const comment = feedback?.comment?.trim() ?? "";

  return `<UserComment direction="${direction}">\n${comment}\n</UserComment>`;
}

function sectionFeedback(
  section: GapSection,
  answers: SectionAnswers | null,
): SectionFeedback | undefined {
  return answers?.sections?.[section.title];
}

function questionTag(
  question: GapQuestion,
  answers: SectionAnswers | null,
): string {
  const questions = answers?.questions;
  const answer = questions?.[question.id]?.trim() || "(unanswered)";

  return `<Question id="${question.id}">\n<Asked>${question.question}</Asked>\n<Answer>${answer}</Answer>\n</Question>`;
}

function sectionComment(
  feedback: SectionFeedback | undefined,
): string | undefined {
  return feedback?.comment?.trim();
}

function tag(name: string, body: string): string {
  return `<${name}>\n${body}\n</${name}>`;
}
