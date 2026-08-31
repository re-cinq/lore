/**
 * Compose the standard footer block for Lore-authored PR bodies (T047).
 *
 * Always includes `Lore-Task: <uuid>` so the web-ui can resolve PR ↔
 * task via the trailer (FR1.5 + FR5.3). When an Issue exists, `Closes #N`
 * rather than `Refs #N`: GitHub links a reference but only ACTS on a closing
 * keyword, so a merged PR left its backlog ticket open and eligible to be
 * picked again. For dark-mode tasks without an Issue, only `Lore-Task` is
 * emitted.
 */
export function prFooter(opts: {
  issueNumber?: number | null;
  taskId: string;
}): string {
  const lines: string[] = [];

  if (opts.issueNumber) {
    lines.push(`Closes #${opts.issueNumber}`);
  }
  lines.push(`Lore-Task: ${opts.taskId}`);

  return `\n\n${lines.join("\n")}`;
}
