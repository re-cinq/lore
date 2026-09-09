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
