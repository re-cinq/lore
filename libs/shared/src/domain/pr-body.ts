/** Compose the standard footer block for Lore-authored PR bodies (T047, FR1.5 + FR5.3): always `Lore-Task: <uuid>`, plus `Closes #N` when an Issue exists (or `Refs #N` when `coverage: "partial"`, so a merge doesn't close a ticket only partly resolved). */
export function prFooter(opts: {
  issueNumber?: number | null;
  taskId: string;
  coverage?: "full" | "partial";
}): string {
  const lines: string[] = [];

  if (opts.issueNumber) {
    const keyword = opts.coverage === "partial" ? "Refs" : "Closes";

    lines.push(`${keyword} #${opts.issueNumber}`);
  }
  lines.push(`Lore-Task: ${opts.taskId}`);

  return `\n\n${lines.join("\n")}`;
}

const LINKED_ISSUE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;

/** The issue a pull request claims to RESOLVE: the number of the first `Closes`/`Fixes`/`Resolves #N` its body names, or null. `Refs #N` is deliberately not one: it names something related, and a reviewer handed it as "the issue this answers" blocks the pull request for not doing what it never claimed (HALEngine#123, 2026-09-30). */
export function linkedIssueNumber(
  prBody: string | null | undefined,
): number | null {
  const match = LINKED_ISSUE.exec(prBody ?? "");

  return match ? Number(match[1]) : null;
}

const LINKED_ISSUES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)/gi;

/** Every issue a pull request names with a keyword, `Refs` included, once each in order: the issues a commit's history links, not the one it claims to resolve ({@link linkedIssueNumber}). */
export function linkedIssueNumbers(prBody: string | null | undefined): number[] {
  const numbers = [...(prBody ?? "").matchAll(LINKED_ISSUES)].map((match) =>
    Number(match[1]),
  );

  return [...new Set(numbers)];
}

const SQUASH_SUBJECT_PR = /\(#(\d+)\)\s*$/;

/** The pull request a squash-merged commit names at the end of its subject, `(#NNNN)`, or null. */
export function mergedPullRequestNumber(subject: string): number | null {
  const match = SQUASH_SUBJECT_PR.exec(subject);

  return match ? Number(match[1]) : null;
}

const LORE_TASK_LINE = /^Lore-Task:\s*([0-9a-f-]+)\s*$/im;

/** The task a Lore-authored pull request belongs to: the uuid on the `Lore-Task:` line {@link prFooter} writes, or null. */
export function loreTaskIdOf(prBody: string | null | undefined): string | null {
  return LORE_TASK_LINE.exec(prBody ?? "")?.[1] ?? null;
}
