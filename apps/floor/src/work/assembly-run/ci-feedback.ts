import {
  ciFeedbackSection,
  type CiFeedback,
} from "@re-cinq/lore-shared/ci-wait/round-brief.js";

export type { CiFeedback };

/** The outcomes a CI wait reports a red build under: `changes_requested` sends the branch back to a round, `failed` (the sha already reported red) sends it to repair-build. Both carry the same feedback args, and gating on the first alone launched run 997026f5's repair-build with no verdict at all — it rebuilt the world to learn one lint error, and died doing it. */
const RED_BUILD_OUTCOMES = new Set(["changes_requested", "failed"]);

/** The CI verdict this launch should answer for, or null when the run did not arrive here from a red build. Gated on the INCOMING visit rather than on the args alone: the args persist on the run after they are acted on, and a later node must not be handed a verdict that has already been repaired. */
export function ciFeedbackOf(
  visits: ReadonlyArray<{ nodeId: string; outcome: string | null }>,
  args: Record<string, unknown>,
): CiFeedback | null {
  const incoming = visits.filter((v) => v.outcome !== null).at(-1);
  const failedChecks = argText(args, "ci_failed_checks");

  if (!RED_BUILD_OUTCOMES.has(incoming?.outcome ?? "") || !failedChecks) {
    return null;
  }

  return {
    sha: argText(args, "ci_feedback_sha"),
    failedChecks,
    summary: argText(args, "ci_failure_summary"),
  };
}

/** One string arg off the run, or "" when it is absent or not a string. */
function argText(args: Record<string, unknown>, key: string): string {
  const value = args[key];

  return typeof value === "string" ? value : "";
}

/** Append what CI reported to the prompt the next node runs on. Kept out of the prompt TEMPLATE so every recipe shares it, exactly as the failure blocks beside it are. */
export function withCiFeedback(
  prompt: string,
  feedback: CiFeedback | null,
): string {
  return feedback ? `${prompt}\n\n${ciFeedbackSection(feedback)}` : prompt;
}
