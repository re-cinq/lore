/**
 * The top-level body of a Lore review — a scannable verdict header, a one-line
 * severity tally derived from the finding labels, and the shared how-to footer.
 * Rendered once per review; the per-line detail lives in the inline
 * {@link ConventionalComment}s.
 */

import type { ReviewOutput } from "./review-findings.js";
import { REVIEW_RERUN_HINT } from "./review-definitions.js";

/** The how-to line shown on the review body and the "review started" PR comment. */
export const REVIEW_HELP = `Reply to any review comment to discuss or approve a fix (e.g. "ok, fix it"). ${REVIEW_RERUN_HINT}`;

export function buildReviewSummary(output: ReviewOutput): string {
  const verdict =
    output.verdict === "approved" ? "Approved" : "Changes suggested";
  const blocks = [`### Lore review — ${verdict}`];

  if (output.summary?.trim()) {
    blocks.push(output.summary.trim());
  }
  blocks.push(tally(output));
  blocks.push(REVIEW_HELP);

  return blocks.join("\n\n");
}

function tally(output: ReviewOutput): string {
  const mustFix = output.findings.filter(
    (f) => f.label === "issue" && f.decoration === "blocking",
  ).length;
  const nits = output.findings.filter((f) => f.label === "nit").length;
  const consider = output.findings.filter(
    (f) =>
      f.label !== "nit" &&
      f.label !== "praise" &&
      !(f.label === "issue" && f.decoration === "blocking"),
  ).length;

  return `Must fix (${mustFix}) · Consider (${consider}) · Nits (${nits})`;
}
