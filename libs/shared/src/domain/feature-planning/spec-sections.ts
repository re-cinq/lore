// The plan sections folded into the spec after the draft took the intent: a round hands every pending section to its own pod at once, each pod returns a patch, and a deterministic step applies the patches, so no two pods ever write the same file (see specs/7-feature-planning/spec.md FR-24).

import { z } from "zod";
import type { CitablePlan } from "./plan-coverage.js";

/** The order sections are handed out in; the intent is the draft's and a prototype is something to look at. */
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

export const sectionOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("append"),
    /** The spec file; the line's first spec when absent. */
    file: z.string().optional(),
    heading: z.string(),
    text: z.string(),
  }),
  z.object({
    op: z.literal("amend"),
    file: z.string().optional(),
    find: z.string().min(1),
    replace: z.string(),
  }),
]);

/** What a section's pod returns: whether it integrated the section, the technical facts it added, and the edits to make. */
export const sectionPatchSchema = sectionResultSchema.extend({
  ops: z.array(sectionOpSchema).default([]),
});

export type SectionResult = z.infer<typeof sectionResultSchema>;
export type SectionOp = z.infer<typeof sectionOpSchema>;
export type SectionPatch = z.infer<typeof sectionPatchSchema>;

export interface SectionState {
  /** The sections the pods of the round in flight were handed, in the order of their items. */
  handed: string[];
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

export function emptySectionState(): SectionState {
  return {
    handed: [],
    done: [],
    failed: [],
    attempts: {},
    redo: [],
    redoRound: 0,
  };
}

/** Every section a round hands out, as the items its fan-out runs a pod for: the sections the gate sent back when it did, else the ones not yet done or failed. */
export function startRound(
  plan: CitablePlan,
  state: SectionState,
  request: RedoRequest | null,
): { items: string[]; state: SectionState } {
  const taken = takeRedo(state, request);
  const slots = taken.redo.length > 0 ? taken.redo : pendingSlots(plan, taken);

  return {
    items: slots.map((slot) => sectionItem(plan, slot)),
    state: { ...taken, handed: slots },
  };
}

/** Takes the sections of a gate round once; a failed one gets its attempts again. */
function takeRedo(
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

function pendingSlots(plan: CitablePlan, state: SectionState): string[] {
  return INTEGRATED_SLOTS.filter(
    (slot) =>
      !state.done.includes(slot) &&
      !state.failed.includes(slot) &&
      plan.blocks.some((block) => block.slot === slot),
  );
}

function sectionItem(plan: CitablePlan, slot: string): string {
  return JSON.stringify({ slot, text: sectionText(plan, slot) });
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

/** The patches in the order the sections were handed: each at its own section's place, whatever order the pods finished in, and none where a pod returned nothing. */
export function alignPatches(
  handed: readonly string[],
  patches: readonly SectionPatch[],
): (SectionPatch | null)[] {
  return handed.map(
    (slot) => patches.find((patch) => patch.section === slot) ?? null,
  );
}

export interface Settled {
  state: SectionState;
  /** Some section was neither done nor given up on, so another round should run. */
  retry: boolean;
}

/** Folds in the patches the round's pods returned, by position: a section whose patch is missing, failed, for another section, empty where it needs technical detail, or has an operation that could not be applied is tried again, then recorded as failed. */
export function settleRound(
  state: SectionState,
  patches: readonly (SectionPatch | null)[],
  failedOps: Record<string, number>,
): Settled {
  const owing = TECHNICAL_SLOTS.filter((owed) => !state.redo.includes(owed));
  const start: Settled = { state, retry: false };

  return state.handed.reduce<Settled>(
    (settled, slot, index) => {
      const patch = patches[index] ?? null;

      return isAccepted(slot, patch, owing, failedOps)
        ? accept(settled, slot)
        : giveBack(settled, slot);
    },
    { ...start, state: { ...state, handed: [] } },
  );
}

function isAccepted(
  slot: string,
  patch: SectionPatch | null,
  owing: readonly string[],
  failedOps: Record<string, number>,
): boolean {
  return (
    patch?.section === slot &&
    usable(slot, patch, owing) &&
    (failedOps[slot] ?? 0) === 0
  );
}

function usable(
  slot: string,
  patch: SectionPatch,
  owing: readonly string[],
): boolean {
  if (patch.status === "failed") {
    return false;
  }

  return (
    patch.status === "nothing_relevant" ||
    !owing.includes(slot) ||
    patch.technical_additions.length > 0
  );
}

function accept(settled: Settled, slot: string): Settled {
  const { state } = settled;

  return {
    ...settled,
    state: {
      ...state,
      done: added(state.done, slot),
      redo: state.redo.filter((redone) => redone !== slot),
      attempts: withoutAttempts(state.attempts, [slot]),
    },
  };
}

function giveBack(settled: Settled, slot: string): Settled {
  const { state } = settled;
  const attempts = (state.attempts[slot] ?? 0) + 1;

  if (attempts < MAX_SECTION_ATTEMPTS) {
    return {
      ...settled,
      retry: true,
      state: { ...state, attempts: { ...state.attempts, [slot]: attempts } },
    };
  }

  return {
    ...settled,
    state: {
      ...state,
      failed: added(state.failed, slot),
      redo: state.redo.filter((redone) => redone !== slot),
      attempts: withoutAttempts(state.attempts, [slot]),
    },
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

export interface Applied {
  files: Record<string, string>;
  /** How many of each section's operations could not be applied. */
  failedOps: Record<string, number>;
}

/** Applies the patches in order to the spec files, so two sections never write one file at once. An amend needs its text to stand exactly once; an append goes to the end of its heading's body, or under a new heading at the end. */
export function applyPatches(
  files: Record<string, string>,
  patches: readonly SectionPatch[],
  defaultFile: string,
): Applied {
  const applied: Applied = { files: { ...files }, failedOps: {} };

  for (const patch of patches) {
    applied.failedOps[patch.section] =
      (applied.failedOps[patch.section] ?? 0) +
      applyOps(applied.files, patch.ops, defaultFile);
  }

  return applied;
}

/** Applies a patch's operations in place; the number that could not be applied. */
function applyOps(
  files: Record<string, string>,
  ops: readonly SectionOp[],
  defaultFile: string,
): number {
  let failed = 0;

  for (const op of ops) {
    const file = op.file ?? defaultFile;
    const changed = file in files ? applyOp(files[file] ?? "", op) : null;

    if (changed === null) {
      failed += 1;
      continue;
    }
    files[file] = changed;
  }

  return failed;
}

function applyOp(text: string, op: SectionOp): string | null {
  if (op.op === "append") {
    return appendUnder(text, op.heading, op.text);
  }

  return text.split(op.find).length === 2
    ? text.replace(op.find, () => op.replace)
    : null;
}

function appendUnder(spec: string, heading: string, text: string): string {
  const lines = spec.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading.trim());

  if (start < 0) {
    return `${spec.trimEnd()}\n\n${heading}\n\n${text.trim()}\n`;
  }
  const end = endOfBody(lines, start, levelOf(heading));
  const body = lines.slice(start + 1, end);

  while (body.at(-1)?.trim() === "") {
    body.pop();
  }

  return [
    ...lines.slice(0, start + 1),
    ...body,
    "",
    text.trim(),
    "",
    ...lines.slice(end),
  ].join("\n");
}

function levelOf(heading: string): number {
  const marks = /^#+/.exec(heading.trim());

  return marks?.[0].length ?? 0;
}

function endOfBody(lines: readonly string[], start: number, level: number) {
  const next = lines.findIndex(
    (line, index) => index > start && headingLevel(line) <= level,
  );

  return next < 0 ? lines.length : next;
}

function headingLevel(line: string): number {
  const marks = /^(#+)\s/.exec(line);

  return marks?.[1]?.length ?? Infinity;
}
