/**
 * Compose the standard footer block for Lore-authored PR bodies (T047).
 *
 * Always includes `Lore-Task: <uuid>` so the web-ui can resolve PR ↔
 * task via the trailer (FR1.5 + FR5.3). When an Issue exists, the default is
 * `Closes #N`: GitHub links a reference but only ACTS on a closing keyword,
 * so a merged PR left its backlog ticket open and eligible to be picked
 * again. `coverage: "partial"` is the deliberate exception — the pr-ready
 * node judged the branch resolves only part of what the ticket reports, so
 * `Refs #N` keeps the issue open on merge instead of closing it on a
 * tangent. For dark-mode tasks without an Issue, only `Lore-Task` is
 * emitted.
 */
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
