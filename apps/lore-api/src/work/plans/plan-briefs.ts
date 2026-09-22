/** What the planning line's agents are told about a plan. The plan itself reaches them as the plan.md their pod downloads, so a brief names the file and never carries its content — a plan of any size keeps the prompt small. Output formats live in the recipes, not here. */

/** The plan as the briefs name it. */
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

/** The first draft: what the author already knows. */
export function draftBrief(plan: PlanView, known: string): string {
  return [
    `Draft the plan "${plan.title}" in plan.md.`,
    "",
    "What the author already knows:",
    known.trim() ||
      "(nothing yet — draft from the title and ask what you need)",
  ].join("\n");
}

/** One section's Refine, named by the marker the agent finds it by; the run carries its hash and uses, so the agent copies nothing. */
export function refineBrief(plan: PlanView, request: RefineRequest): string {
  return `Refine only the section "${request.title}" (<!-- slot:${request.slot} -->) of plan.md for "${plan.title}". Build on its answered questions and resolved comments, and leave every other section as it is.`;
}

/** The approved plan, handed to the spec work that follows approval. */
export function approvedBrief(plan: PlanView): string {
  return `The approved plan "${plan.title}" is in plan.md. It is settled: map it onto this repository's specs; do not re-open it.`;
}
