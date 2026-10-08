// The plan sections folded into the spec one pod at a time, after the draft took the intent: which section is next, and what the integrating writer reads of it.

import type { CitablePlan } from "./plan-coverage.js";

/** The order sections are integrated in; the intent is the draft's and a prototype is something to look at. */
export const INTEGRATED_SLOTS = [
  "scope",
  "kpis",
  "constraints",
  "ownership",
  "delivery",
  "risk",
  "trigger",
  "questions",
];

export interface NextSection {
  slot: string;
  text: string;
  /** Every slot taken so far, this one included. */
  done: string[];
}

export function nextSection(
  plan: CitablePlan,
  done: readonly string[],
): NextSection | null {
  const slot = INTEGRATED_SLOTS.find(
    (candidate) =>
      !done.includes(candidate) &&
      plan.blocks.some((block) => block.slot === candidate),
  );

  if (slot === undefined) {
    return null;
  }

  return { slot, text: sectionText(plan, slot), done: [...done, slot] };
}

function sectionText(plan: CitablePlan, slot: string): string {
  const lines = plan.blocks
    .filter((block) => block.slot === slot)
    .map((block) => `- ${block.text} ([plan](${block.link}))\n`);

  return `## ${slot}\n\n${lines.join("")}`;
}
