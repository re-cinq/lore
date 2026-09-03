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

export function buildReviewSummary(
  output: ReviewOutput,
  opts: { model?: string } = {},
): string {
  const verdict =
    output.verdict === "approved" ? "Approved" : "Changes suggested";
  const blocks = [`### Lore review — ${verdict}`];

  if (output.summary?.trim()) {
    blocks.push(output.summary.trim());
  }
  blocks.push(tally(output));

  // Which model judged the diff, on every review body: reviewer models are
  // switched per repo (agent-definition rows), and a finding's weight reads
  // differently depending on who wrote it.
  if (opts.model) {
    blocks.push(`_Reviewed by \`${opts.model}\`_`);
  }
  blocks.push(REVIEW_HELP);

  return blocks.join("\n\n");
}

/**
 * The body posted when the review could not run because the LLM budget is
 * exhausted. The PR is APPROVED to stay unblocked — a spent account is an
 * operator problem, not the author's — but the approval says loudly that no
 * judgment happened, and names the reviewer that would have run.
 */
export function budgetSkipBody(model?: string): string {
  const blocks = [
    "### Lore review — Approved without review (no LLM budget)",
    "The review could not run: the account's LLM budget is exhausted. " +
      "Approving so this PR is not blocked on an operator problem — no " +
      "judgment of the diff has happened.",
    model ? `_Reviewer that would have run: \`${model}\`_` : undefined,
    REVIEW_RERUN_HINT,
  ];

  return blocks.filter((b): b is string => !!b).join("\n\n");
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
