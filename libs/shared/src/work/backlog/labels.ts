/** The backlog label taxonomy (implementation-loop FR1) — applying a priority label IS the opt-in, no second dispatch label. */

export const PRIORITY_LABELS = [
  "priority:high",
  "priority:medium",
  "priority:low",
] as const;

export type PriorityLabel = (typeof PRIORITY_LABELS)[number];

export const LORE_BLOCKED_LABEL = "lore:blocked";

/** Seed set for `createLabels` (create-or-ignore-existing) — onboarding. */
export const BACKLOG_LABEL_SEED: Array<{
  name: string;
  color: string;
  description: string;
}> = [
  {
    name: "priority:high",
    color: "B60205",
    description: "Backlog loop: work this first",
  },
  {
    name: "priority:medium",
    color: "FBCA04",
    description: "Backlog loop: work after every priority:high",
  },
  {
    name: "priority:low",
    color: "C2E0C6",
    description: "Backlog loop: work when nothing else is queued",
  },
  {
    name: LORE_BLOCKED_LABEL,
    color: "000000",
    description: "Backlog loop: stuck, needs a human; remove to re-queue",
  },
];
