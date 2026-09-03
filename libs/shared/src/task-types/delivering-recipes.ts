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
] as const;

export function isDeliveringRecipe(
  promptRef: string | null | undefined,
): boolean {
  return (DELIVERING_PROMPT_REFS as readonly string[]).includes(
    promptRef ?? "",
  );
}
