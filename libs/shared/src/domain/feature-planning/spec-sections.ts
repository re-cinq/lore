// The plan sections folded into the spec one pod at a time, after the draft took the intent: which section is handed out next, how a pod's returned result settles it, and which sections the gate sends back (see specs/7-feature-planning/spec.md FR-24).

import { z } from "zod";
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

/** The sections whose pod must bring technical detail from the repository; the others have none to add, and asking would invite filler. */
export const TECHNICAL_SLOTS = ["scope", "constraints", "delivery"];

export const MAX_SECTION_ATTEMPTS = 2;

/** The visit for gaps no question maps to a section: names not on main, compound requirements. */
const REPAIR = "*";

export const sectionResultSchema = z.object({
  section: z.string(),
  status: z.enum(["integrated", "nothing_relevant", "failed"]),
  technical_additions: z
    .array(z.object({ claim: z.string(), source: z.string() }))
    .default([]),
});

export type SectionResult = z.infer<typeof sectionResultSchema>;

export interface SectionState {
  /** The section a pod was last handed and has not settled yet. */
  handed: string | null;
  done: string[];
  failed: string[];
  attempts: Record<string, number>;
  /** Sections the gate sent back, not yet redone. */
  redo: string[];
  redoRound: number;
}

export interface RedoRequest {
  round: number;
  sections: string[];
}

export interface Step {
  outcome: "more" | "redo" | "done";
  text: string;
  state: SectionState;
}

export function emptySectionState(): SectionState {
  return {
    handed: null,
    done: [],
    failed: [],
    attempts: {},
    redo: [],
    redoRound: 0,
  };
}

export function nextStep(plan: CitablePlan, state: SectionState): Step {
  const slot = state.handed ?? pendingSlot(plan, state) ?? state.redo.at(0);

  if (slot === undefined) {
    return { outcome: "done", text: "", state };
  }

  return {
    outcome: state.redo.includes(slot) ? "redo" : "more",
    text: sectionText(plan, slot),
    state: { ...state, handed: slot },
  };
}

function pendingSlot(plan: CitablePlan, state: SectionState) {
  return INTEGRATED_SLOTS.find(
    (slot) =>
      !state.done.includes(slot) &&
      !state.failed.includes(slot) &&
      plan.blocks.some((block) => block.slot === slot),
  );
}

function sectionText(plan: CitablePlan, slot: string): string {
  if (slot === REPAIR) {
    return `## repair\n\nFix what plan-coverage.md and qa-failures.md list; no plan section is attached to this visit.\n`;
  }
  const lines = blocksOf(plan.blocks, slot).map(
    (block) => `- ${block.text} ([plan](${block.link}))\n`,
  );

  return `## ${slot}\n\n${technicalLine(slot)}\n\n${lines.join("")}`;
}

function technicalLine(slot: string): string {
  return TECHNICAL_SLOTS.includes(slot)
    ? "Technical additions: required."
    : "Technical additions: none; add no filler.";
}

function blocksOf(blocks: CitablePlan["blocks"], slot: string) {
  return blocks.filter((block) => block.slot === slot);
}

/** Folds in what the pod handed the section returned; a section whose result is missing, failed or empty where it needs technical detail is tried again, then recorded as failed. */
export function settle(
  state: SectionState,
  result: SectionResult | null,
): SectionState {
  const slot = state.handed;

  if (slot === null) {
    return state;
  }

  // A section sent back to be redone has its technical facts already.
  const owing = TECHNICAL_SLOTS.filter((owed) => !state.redo.includes(owed));

  return accepted(slot, result, owing)
    ? finished(state, slot)
    : retried(state, slot);
}

function accepted(
  slot: string,
  result: SectionResult | null,
  owing: readonly string[],
): boolean {
  return result?.section === slot && usable(slot, result, owing);
}

function usable(
  slot: string,
  result: SectionResult,
  owing: readonly string[],
): boolean {
  if (result.status === "failed") {
    return false;
  }

  return (
    result.status === "nothing_relevant" ||
    !owing.includes(slot) ||
    result.technical_additions.length > 0
  );
}

function finished(state: SectionState, slot: string): SectionState {
  return {
    ...state,
    handed: null,
    done: added(state.done, slot),
    redo: state.redo.filter((redone) => redone !== slot),
    attempts: withoutAttempts(state.attempts, [slot]),
  };
}

function retried(state: SectionState, slot: string): SectionState {
  const attempts = (state.attempts[slot] ?? 0) + 1;

  if (attempts < MAX_SECTION_ATTEMPTS) {
    return { ...state, attempts: { ...state.attempts, [slot]: attempts } };
  }

  return {
    ...state,
    handed: null,
    failed: added(state.failed, slot),
    redo: state.redo.filter((redone) => redone !== slot),
    attempts: withoutAttempts(state.attempts, [slot]),
  };
}

/** Takes the sections the gate sent back, once per round; a failed one gets its attempts again. */
export function absorbRedo(
  state: SectionState,
  request: RedoRequest | null,
): SectionState {
  if (request === null || request.round <= state.redoRound) {
    return state;
  }
  const sections = [...new Set(request.sections)];

  return {
    ...state,
    done: sections.reduce(added, state.done),
    failed: state.failed.filter((slot) => !sections.includes(slot)),
    attempts: withoutAttempts(state.attempts, sections),
    redo: sections,
    redoRound: request.round,
  };
}

function added(list: string[], slot: string): string[] {
  return slot === REPAIR || list.includes(slot) ? list : [...list, slot];
}

function withoutAttempts(
  attempts: Record<string, number>,
  slots: readonly string[],
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(attempts).filter(([slot]) => !slots.includes(slot)),
  );
}
