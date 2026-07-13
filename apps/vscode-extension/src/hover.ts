/**
 * Pure markdown body for a decoration hover. Returns a string the caller wraps
 * in a trusted `vscode.MarkdownString`; every link is an `openLocal` command URI
 * so it opens the local document (never a browser). Pure + tested so the link
 * wiring can't regress silently.
 */

import type { RangeEntry } from "./spec-index.js";
import { openLocalCommandUri } from "./command-links.js";

export function renderHoverMarkdown(entry: RangeEntry): string {
  const verb =
    entry.layer === "implemented" ? "Implements" : "Covered by a test for";
  const out: string[] = [
    `**Lore** · ${verb} a spec statement _(${entry.evidence})_`,
    "",
    `> ${entry.statementText}`,
    "",
    `[Open spec](${openLocalCommandUri({ path: entry.specPath, line: entry.specLine || 1 })})`,
  ];
  for (const target of entry.related) {
    if (target.line === null) continue;
    out.push(
      `[Open ${target.label}](${openLocalCommandUri({ path: target.path, line: target.line })})`,
    );
  }
  return out.join("\n");
}
