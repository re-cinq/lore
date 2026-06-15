/**
 * Compose the standard footer block for Lore-authored PR bodies (T047).
 *
 * Always includes `Lore-Task: <uuid>` so the web-ui can resolve PR ↔
 * task via the trailer (FR1.5 + FR5.3). The legacy `Refs #N` line is
 * preserved when an Issue exists (opt-out repos and approval-gated
 * tasks); for dark-mode tasks without an Issue, only `Lore-Task` is
 * emitted.
 */
export function prFooter(opts: {
  issueNumber?: number | null;
  taskId: string;
}): string {
  const lines: string[] = [];
  if (opts.issueNumber) lines.push(`Refs #${opts.issueNumber}`);
  lines.push(`Lore-Task: ${opts.taskId}`);
  return `\n\n${lines.join("\n")}`;
}
