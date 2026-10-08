import { z } from "zod";

/** What the planning line's agents are told about a plan. The plan itself reaches them as the plan.md their pod downloads, so a brief names the file and never carries its content — a plan of any size keeps the prompt small. Output formats live in the recipes, not here. */

/** The plan as the briefs name it. */
export interface PlanView {
  title: string;
}

/** A finding standing on the plan: what a check says does not hold, and where. The agent cannot read these through `lore_plan_read` — the read drops margin notes — so the brief is the only place it learns of them. */
export interface OpenFinding {
  findingId: string;
  slot: string;
  severity: string;
  text: string;
  why: string;
}

/** The editor's Refine ask: one section, what is settled in it, and its hash at the time of asking. */
export interface RefineRequest {
  slot: string;
  title: string;
  baseHash: string;
  inputs: unknown;
  uses: unknown;
  /** The user story a round this ask starts carries; an ask reported to a waiting run cannot change the story that run started with. */
  storyIssue?: number;
  /** Who asked, as the floor records it on the visit the ask opens. */
  actor: string;
}

/** The first draft: what the author already knows, and anything a check has already said does not hold. */
export function draftBrief(
  plan: PlanView,
  known: string,
  findings: readonly OpenFinding[] = [],
): string {
  return withFindings(
    [
      `Draft the plan "${plan.title}" in plan.md.`,
      "",
      "What the author already knows:",
      known.trim() ||
        "(nothing yet — draft from the title and ask what you need)",
    ].join("\n"),
    findings,
  );
}

/** One section's Refine, named by the marker the agent finds it by; the run carries its hash and uses, so the agent copies nothing. An answer is a fact about the plan, not about one section, so the pass may follow it into the sections it contradicts, and add the sections it asks for — told only to "refine this section", an agent writes a requested section-per-item into that one section. The pass's end marks every input it was handed used, so the brief lists them by id: a refine that wrote one in only as a reformat cleared its marker regardless. */
export function refineBrief(
  plan: PlanView,
  request: RefineRequest,
  findings: readonly OpenFinding[] = [],
): string {
  const ask = `Refine the section "${request.title}" (<!-- slot:${request.slot} -->) of the live plan "${plan.title}", building on its answered questions and resolved comments. Where a settled answer asks for structure the plan lacks — a section per item, say — add those sections with \`add-section\`, placed after this one, rather than writing them into this section. Where a settled comment or answered question asks for this section to go, remove it with \`remove-section\` instead of emptying it. Change another existing section ONLY where one of those settled answers makes what it says wrong, or where a finding listed below is on it. Your edits land in the live plan as you make them, and nobody accepts them first: never write a claim that another section or a settled answer contradicts, and ask with \`add-question\` where you disagree with one. Leave every other section exactly as it is.`;
  const settled = settledLines(request.inputs);

  return withFindings(
    settled.length === 0
      ? ask
      : [ask, [WRITE_EACH, ...settled].join("\n")].join("\n\n"),
    findings,
  );
}

/** Findings are not the conversation: nobody resolves them by hand on an approved plan, whose editor is read-only, so they are work for the pass. The block itself stays — the check that wrote it reconciles its own on the next pass, which is what makes a finding disappear when its cause is gone. */
function withFindings(brief: string, findings: readonly OpenFinding[]): string {
  return findings.length === 0
    ? brief
    : [brief, [FIX_EACH, ...findings.map(findingLine)].join("\n")].join("\n\n");
}

const FIX_EACH =
  "Findings on this plan, each one something it says that does not hold. Fix the section a finding names so it no longer holds, even where that is not the section you were asked to refine. Leave the finding block itself alone: the check that wrote it clears it, not you. One you think is wrong, say so with `add-question` on its section and change nothing there.";

function findingLine(finding: OpenFinding): string {
  return `- Finding ${finding.findingId} on \`${finding.slot}\` (${finding.severity}): ${oneLine(finding.text)} — ${oneLine(finding.why)}`;
}

const WRITE_EACH =
  "Write each of these into the section. One you cannot use, ask about with `add-question` rather than leave out: a refine that ends without them still marks them used.";

const settledInputsSchema = z.object({
  answered: z
    .array(
      z.object({
        questionId: z.string(),
        question: z.string(),
        answer: z.string(),
      }),
    )
    .default([]),
  resolved: z
    .array(
      z.object({
        commentId: z.string(),
        said: z
          .array(z.object({ author: z.string(), text: z.string() }))
          .default([]),
      }),
    )
    .default([]),
});

/** The settled inputs the editor handed the ask, one line each; a shape this does not know lists none rather than refusing the Refine. */
function settledLines(inputs: unknown): string[] {
  const parsed = settledInputsSchema.safeParse(inputs);

  if (!parsed.success) {
    return [];
  }
  const { answered, resolved } = parsed.data;

  return [
    ...answered.map(
      (one) =>
        `- Answered ${one.questionId}: "${oneLine(one.question)}" — ${oneLine(one.answer)}`,
    ),
    ...resolved.map(
      ({ commentId, said }) =>
        `- Resolved thread ${commentId}: ${said.map(({ author, text }) => `${author}: "${oneLine(text)}"`).join(" ")}`,
    ),
  ];
}

/** People's text on one line: a newline in an answer would start what reads as another item of the list. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The approved plan, handed to the spec work that follows approval. */
export function approvedBrief(plan: PlanView): string {
  return `The approved plan "${plan.title}" is in plan.md. It is settled: map it onto this repository's specs; do not re-open it.`;
}

/** The plan changed after its specs merged: the fresh spec pass amends what is on main rather than writing it again. */
export function revisedBrief(plan: PlanView, prNumber: number): string {
  return `${approvedBrief(plan)} The specs on main were written from an earlier version of this plan (spec PR #${prNumber}); amend them to say what the plan says now, and leave what still holds alone.`;
}

/** The spec PR is still open: the fresh pass amends the specs on its branch rather than opening a second PR. */
export function openPrBrief(plan: PlanView, prNumber: number): string {
  return `${approvedBrief(plan)} Spec PR #${prNumber} is open on this branch with the specs an earlier pass wrote; amend them to say what the plan says now, and leave what still holds alone.`;
}
