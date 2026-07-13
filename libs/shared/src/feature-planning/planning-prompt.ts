import {
  type GapResult,
  type GapSection,
  type GapQuestion,
  type SectionDirection,
  sectionsOf,
} from "./gap-result.js";

/**
 * The author's feedback for a planning round: per-section comment + direction
 * (keyed by section title), answers keyed by question id, and a free-form note.
 * Mirrors the web UI's SectionAnswers (the wizard's FeedbackState serialized).
 */
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

/**
 * Builds the per-round planning prompt as XML-tagged context so the agent can
 * cleanly tell apart the request, what it generated last round, and what the
 * author wants changed. Pure.
 *
 * Round 1 (no prior result) is just <Title> + <UserPrompt>. Refinement rounds add a
 * <CurrentDraftSpec> that, per section, pairs the prior <Generated> output with that
 * section's answered <Questions> and the author's <UserComment direction=…>, and
 * surfaces the free-form note as <OtherUserComments>.
 */
export function composePlanningPrompt(input: PlanningPromptInput): string {
  const blocks = [
    tag("Title", input.title),
    tag("UserPrompt", input.originalPrompt),
  ];
  const draftSpec = currentDraftSpec(input.priorGap, input.answers);
  if (draftSpec) blocks.push(draftSpec);
  return blocks.join("\n\n");
}

function tag(name: string, body: string): string {
  return `<${name}>\n${body}\n</${name}>`;
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
  if (note) inner.push(tag("OtherUserComments", note));
  return tag("CurrentDraftSpec", inner.join("\n\n"));
}

function sectionBlock(
  section: GapSection,
  answers: SectionAnswers | null,
): string {
  const parts = [tag("Generated", generatedContent(section))];
  if (section.questions?.length)
    parts.push(questionsBlock(section.questions, answers));
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
  if (section.content?.trim()) parts.push(section.content.trim());
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
  const body = questions
    .map((q) => {
      const answer = answers?.questions?.[q.id]?.trim() || "(unanswered)";
      return `<Question id="${q.id}">\n<Asked>${q.question}</Asked>\n<Answer>${answer}</Answer>\n</Question>`;
    })
    .join("\n");
  return tag("Questions", body);
}
