// How the one-story review writes for GitHub: counts, and prose escaped so Markdown shows it as written.
export const LINKS_ONLY =
  "Only links changed in the Markdown of this pull request: nothing to review.";

export function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// Inline code is shown as written: GitHub renders a backslash or an entity inside it literally.
export function escapeMarkdown(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .split(/(`[^`]+`)/)
    .map((part, index) => (index % 2 ? part : escapedProse(part)))
    .join("");
}

export function escapedProse(prose: string): string {
  return prose
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "&#64;")
    .replace(/[\\*_[\]~]/g, "\\$&");
}
