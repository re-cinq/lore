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

/** One section's Refine, named by the marker the agent finds it by; the run carries its hash and uses, so the agent copies nothing. An answer is a fact about the plan, not about one section, so the pass may follow it into the sections it contradicts, and add the sections it asks for — told only to "refine this section", an agent writes a requested section-per-item into that one section. */
export function refineBrief(plan: PlanView, request: RefineRequest): string {
  return `Refine the section "${request.title}" (<!-- slot:${request.slot} -->) of plan.md for "${plan.title}", building on its answered questions and resolved comments. Where a settled answer asks for structure the plan lacks — a section per item, say — add those sections as new \`## Title\` headings with no marker, placed after this one, rather than writing them into this section. Change another existing section ONLY where one of those settled answers makes what it says wrong. Each section you add or touch is proposed on its own, for a person to accept or refuse. Leave every other section exactly as it is.`;
}

/** The approved plan, handed to the spec work that follows approval. */
export function approvedBrief(plan: PlanView): string {
  return `The approved plan "${plan.title}" is in plan.md. It is settled: map it onto this repository's specs; do not re-open it.`;
}

/** The plan changed after its specs merged: the fresh spec pass amends what is on main rather than writing it again. */
export function revisedBrief(plan: PlanView, prNumber: number): string {
  return `${approvedBrief(plan)} The specs on main were written from an earlier version of this plan (spec PR #${prNumber}); amend them to say what the plan says now, and leave what still holds alone.`;
}
