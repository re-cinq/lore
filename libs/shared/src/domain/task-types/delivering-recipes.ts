/** Recipes that change the branch; must commit and push before finishing (next node has fresh clone). */
export const DELIVERING_PROMPT_REFS = [
  "implementation-tdd",
  "implementation",
  "address-feedback",
  // TDD line: every node commits and pushes (fresh pod clone).
  "acceptance-dod",
  "tdd-round",
  "fix-ci",
  "pr-ready",
  // The planning line: write commits the specs and the push node is another pod, so an unpushed write reached push as an empty branch (plan b5ec0e24, 2026-09-23).
  "spec-write",
  // The gap-fill and general lines: draft/implement, validate and push are three pods, and neither recipe said push, so 17 of 36 gap-fill branches carried zero commits (2026-08-15..09-25) — validate then linted the whole tree unscoped and was OOM-killed, or push found nothing and no PR could open.
  "gap-fill",
  "general",
] as const;

export function isDeliveringRecipe(
  promptRef: string | null | undefined,
): boolean {
  return (DELIVERING_PROMPT_REFS as readonly string[]).includes(
    promptRef ?? "",
  );
}
