// A round's own report of what it finished and left for next, carried from its extras into the run's args and into the next round's prompt (FR6.17).

/** A round's own account of itself, lifted off its `Lore-Tdd-Done` / `Lore-Tdd-Next` extras into the run's args so the NEXT round does not start cold — extras alone never reach a later node (FR6.17). */
export interface RoundHandoff {
  done: string | null;
  next: string;
}

const HANDOFF_EXTRAS = {
  done: "Lore-Tdd-Done",
  next: "Lore-Tdd-Next",
} as const;

/** The args a finishing node's extras add to the run: the hand-off keys, or null when the node reported none. */
export function roundHandoffArgsOf(
  extras: Readonly<Record<string, string>> | undefined,
): Record<string, string> | null {
  const next = extras?.[HANDOFF_EXTRAS.next];

  if (!next) {
    return null;
  }
  const done = extras[HANDOFF_EXTRAS.done];

  return { round_next: next, ...(done ? { round_done: done } : {}) };
}

/** The hand-off the run's args carry, as the next prompt reads it. */
export function roundHandoffOf(
  args: Readonly<Record<string, unknown>>,
): RoundHandoff | null {
  const next = args.round_next;

  if (typeof next !== "string" || next.length === 0) {
    return null;
  }
  const done = args.round_done;

  return { next, done: typeof done === "string" && done ? done : null };
}

/** Append the previous round's report so a round continues where the last one stopped instead of re-deriving it from the branch. */
export function withRoundHandoff(
  prompt: string,
  handoff: RoundHandoff | null,
): string {
  if (!handoff) {
    return prompt;
  }
  const doneLine = handoff.done ? `- Done: ${handoff.done}\n` : "";

  return `${prompt}

## The previous round reported

${doneLine}- Next: ${handoff.next}
`;
}
