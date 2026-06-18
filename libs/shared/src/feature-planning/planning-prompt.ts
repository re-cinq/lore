import type { GapResult, SectionDirection } from "./gap-result.js";

/**
 * The author's feedback for a planning round: per-section comment + direction,
 * answers keyed by question id, and a free-form note. Mirrors the web UI's
 * SectionAnswers (the wizard's FeedbackState serialized).
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
 * Round 1 (no prior result) is just <Title> + <UserPrompt>. Refinement rounds
 * add a <CurrentDraftSpec> that pairs each generated section with the author's
 * <UserComment direction=…>, resolves answered <Questions> back to their asked
 * text, and surfaces the free-form note as <OtherUserComments>.
 */
export function composePlanningPrompt(input: PlanningPromptInput): string {
  const blocks = [tag("Title", input.title), tag("UserPrompt", input.originalPrompt)];
  const draftSpec = currentDraftSpec(input.priorGap, input.answers);

  if (draftSpec) blocks.push(draftSpec);

  return blocks.join("\n\n");
}

function tag(name: string, body: string): string {
  return `<${name}>\n${body}\n</${name}>`;
}

function currentDraftSpec(gap: GapResult | null, answers: SectionAnswers | null): string | null {
  if (!gap) {
    const note = answers?.free_form?.trim();
    return note ? tag("OtherUserComments", note) : null;
  }

  const inner = [sectionBlock("Architecture", architectureGenerated(gap), answers?.sections?.architecture)];
  if (gap.user_flows.length) {
    inner.push(sectionBlock("UserFlows", flowsGenerated(gap.user_flows), answers?.sections?.user_flows));
  }
  if (gap.mockups.length) {
    const titles = gap.mockups.map((m, i) => `- ${m.title || `Mockup ${i + 1}`}`).join("\n");
    inner.push(sectionBlock("Mockups", titles, answers?.sections?.mockups));
  }
  if (gap.questions.length) inner.push(questionsBlock(gap, answers));
  const note = answers?.free_form?.trim();
  if (note) inner.push(tag("OtherUserComments", note));

  return tag("CurrentDraftSpec", inner.join("\n\n"));
}

function sectionBlock(
  name: string,
  generated: string,
  feedback: { comment?: string; direction?: SectionDirection } | undefined,
): string {
  const parts = [tag("Generated", generated)];
  if (feedback?.comment?.trim() || feedback?.direction) {
    const direction = feedback.direction ?? "keep";
    parts.push(`<UserComment direction="${direction}">\n${feedback.comment?.trim() ?? ""}\n</UserComment>`);
  }
  return tag(name, parts.join("\n"));
}

function architectureGenerated(gap: GapResult): string {
  const lines = [gap.architecture.summary, "", "Components:"];
  for (const c of gap.architecture.components) {
    const touchpoints = c.touchpoints?.length ? ` (touchpoints: ${c.touchpoints.join(", ")})` : "";
    lines.push(`- ${c.name}: ${c.responsibility}${touchpoints}`);
  }
  return lines.join("\n");
}

function flowsGenerated(flows: GapResult["user_flows"]): string {
  return flows
    .map((f) => [f.name, ...f.steps.map((s, i) => `${i + 1}. ${s}`)].join("\n"))
    .join("\n\n");
}

function questionsBlock(gap: GapResult, answers: SectionAnswers | null): string {
  const body = gap.questions
    .map((q) => {
      const answer = answers?.questions?.[q.id]?.trim() || "(unanswered)";
      return `<Question id="${q.id}">\n<Asked>${q.question}</Asked>\n<Answer>${answer}</Answer>\n</Question>`;
    })
    .join("\n");
  return tag("Questions", body);
}
