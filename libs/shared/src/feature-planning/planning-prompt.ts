import {
  type GapResult,
  type GapSection,
  type GapQuestion,
  type SectionDirection,
  sectionsOf,
} from "./gap-result.js";

/** Author feedback for planning round: per-section comment+direction, question answers, free-form note (mirrors UI FeedbackState). */
export interface SectionAnswers {
  sections: Record<string, { comment?: string; direction?: SectionDirection }>;
  questions: Record<string, string>;
  free_form: string;
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

function tag(name: string, body: string): string {
  return `<${name}>\n${body}\n</${name}>`;
}

export interface RoundFeedbackInput {
  /** Which round this is, 1-based — the agent uses it to know it is refining. */
  round: number;
  /** The round being reacted to, read only for its section and question TEXT. */
  priorGap: GapResult | null;
  answers: SectionAnswers | null;
}

/** Turn for round CONTINUING previous conversation; only new feedback (omits untouched sections); pairs with composePlanningPrompt(). */
export function composeRoundFeedback(input: RoundFeedbackInput): string {
  const touched = sectionsOf(input.priorGap)
    .map((section) => feedbackBlock(section, input.answers))
    .filter((block): block is string => block !== null);
  const note = input.answers?.free_form?.trim();

  if (note) {
    touched.push(tag("OtherUserComments", note));
  }

  const body = touched.length ? `${touched.join("\n")}\n` : "";

  return `<RoundFeedback round="${input.round}">\n${body}</RoundFeedback>`;
}

type SectionFeedback = { comment?: string; direction?: SectionDirection };

function sectionFeedback(
  section: GapSection,
  answers: SectionAnswers | null,
): SectionFeedback | undefined {
  return answers?.sections?.[section.title];
}

function sectionComment(
  feedback: SectionFeedback | undefined,
): string | undefined {
  return feedback?.comment?.trim();
}

function sectionDirection(
  feedback: SectionFeedback | undefined,
): SectionDirection {
  return feedback?.direction ?? "refine";
}

function answeredQuestions(
  section: GapSection,
  feedback: SectionFeedback | undefined,
  answers: SectionAnswers | null,
): GapQuestion[] {
  return (section.questions ?? []).filter(
    (q) => feedback || answers?.questions?.[q.id]?.trim(),
  );
}

function questionTag(
  question: GapQuestion,
  answers: SectionAnswers | null,
): string {
  const answer = answers?.questions?.[question.id]?.trim() || "(unanswered)";

  return `<Question id="${question.id}">\n<Asked>${question.question}</Asked>\n<Answer>${answer}</Answer>\n</Question>`;
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

/** One section's feedback, or null when the author said nothing about it. */
function feedbackBlock(
  section: GapSection,
  answers: SectionAnswers | null,
): string | null {
  const feedback = sectionFeedback(section, answers);
  const comment = sectionComment(feedback);
  const answered = answeredQuestions(section, feedback, answers);

  if (!feedback && !answered.length) {
    return null;
  }
  const title = section.title.replace(/"/g, "'");
  const direction = sectionDirection(feedback);
  const parts: string[] = [];

  if (comment) {
    parts.push(tag("UserComment", comment));
  }

  for (const question of answered) {
    parts.push(questionTag(question, answers));
  }

  return renderFeedbackSection(title, direction, parts);
}

function currentDraftSpec(
  gap: GapResult | null,
  answers: SectionAnswers | null,
): string | null {
  const sections = sectionsOf(gap);

  if (!sections.length) {
    const note = answers?.free_form?.trim();

    return note ? tag("OtherUserComments", note) : null;
  }
  const inner = sections.map((s) => sectionBlock(s, answers));
  const note = answers?.free_form?.trim();

  if (note) {
    inner.push(tag("OtherUserComments", note));
  }

  return tag("CurrentDraftSpec", inner.join("\n\n"));
}

function sectionBlock(
  section: GapSection,
  answers: SectionAnswers | null,
): string {
  const parts = [tag("Generated", generatedContent(section))];

  if (section.questions?.length) {
    parts.push(questionsBlock(section.questions, answers));
  }
  const feedback = answers?.sections?.[section.title];

  if (feedback?.comment?.trim() || feedback?.direction) {
    const direction = feedback.direction ?? "keep";

    parts.push(
      `<UserComment direction="${direction}">\n${feedback.comment?.trim() ?? ""}\n</UserComment>`,
    );
  }

  return `<Section title="${section.title.replace(/"/g, "'")}">\n${parts.join("\n")}\n</Section>`;
}

function generatedContent(section: GapSection): string {
  const parts: string[] = [];

  if (section.content?.trim()) {
    parts.push(section.content.trim());
  }

  if (section.mockups?.length) {
    parts.push(
      `Diagrams: ${section.mockups.map((m, i) => m.title || `Mockup ${i + 1}`).join(", ")}`,
    );
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
