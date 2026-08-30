/**
 * The recipes whose job is to CHANGE THE BRANCH — and which must therefore
 * commit and push before they end, because the node that runs next is another
 * pod with a fresh clone.
 *
 * Named once, here, because two things read it: the prompt tests, which check
 * each of these carries the delivery contract, and the Floor, which refuses a
 * "successful" run of one that left its branch empty. 18 of 18
 * implementation-loop branches carried zero commits before either existed
 * (2026-08-30): the implement pod's edits died with the pod, and the push node
 * — cloning fresh — found nothing to deliver.
 */
export const DELIVERING_PROMPT_REFS = [
  "implementation-tdd",
  "implementation",
  "address-feedback",
  // The TDD line's four: every one of them ends by committing and pushing,
  // because every one of them runs in its own pod with a fresh clone.
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
