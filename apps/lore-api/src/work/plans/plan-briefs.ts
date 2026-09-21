/** What the planning line's agents are told about a plan: the plan's own JSON projection, framed for the step that reads it. Output formats live in the recipes, not here. */

/** The plan as the agents see it: the planning-sync JSON projection. */
export interface PlanView {
  title: string;
}

/** The editor's Refine ask: one section, what is settled in it, and its hash at the time of asking. */
export interface RefineRequest {
  slot: string;
  title: string;
  baseHash: string;
  inputs: unknown;
  uses: unknown;
}

/** The first draft: what the author already knows, and the template it lands in. */
export function draftBrief(plan: PlanView, known: string): string {
  return [
    `Draft the plan "${plan.title}".`,
    "",
    "What the author already knows:",
    known.trim() ||
      "(nothing yet — draft from the title and ask what you need)",
    "",
    ...asJson("The plan as it stands:", plan),
  ].join("\n");
}

/** One section's Refine: answered as a proposal the plan's people accept, never a direct write. */
export function refineBrief(plan: PlanView, request: RefineRequest): string {
  return [
    `Refine only the section ${request.slot} (${request.title}) of "${plan.title}" and answer with a proposal.`,
    "",
    ...asJson(
      "The refine request (copy its slot, baseHash and uses into your proposal):",
      request,
    ),
    "",
    ...asJson("The plan as it stands:", plan),
  ].join("\n");
}

/** The approved plan, handed to the spec work that follows approval. */
export function approvedBrief(plan: PlanView): string {
  return [
    `The approved plan "${plan.title}". It is settled: map it onto this repository's specs; do not re-open it.`,
    "",
    ...asJson(null, plan),
  ].join("\n");
}

function asJson(label: string | null, value: unknown): string[] {
  return [
    ...(label ? [label] : []),
    "```json",
    JSON.stringify(value, null, 2),
    "```",
  ];
}
