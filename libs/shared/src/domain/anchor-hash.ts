// The content hash a spec link carries for the line it cites (`[label@a3f9c1d2](path#Lnn)`): the same line hashes the same in any language, however it is quoted, spaced or cased, so a link follows its line when the file moves around it.
import { createHash } from "node:crypto";

export const ANCHOR_HASH_LENGTH = 8;
const MIN_HASHABLE = 8;

/** Lowercase, then only [a-z0-9]: the same text whatever the language, quoting or whitespace. */
export function normalizeAnchorLine(line: string): string {
  return line.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Whether a line carries enough text to be anchored by content: `});` and blank lines do not. */
export function isHashableLine(line: string): boolean {
  return normalizeAnchorLine(line).length >= MIN_HASHABLE;
}

/** The first 8 hex chars of sha256 over the normalized line, or null for a line too short to anchor. */
export function anchorHashOf(line: string): string | null {
  if (!isHashableLine(line)) {
    return null;
  }

  return createHash("sha256")
    .update(normalizeAnchorLine(line))
    .digest("hex")
    .slice(0, ANCHOR_HASH_LENGTH);
}

/** Every 1-based line of `source` whose hash equals `hash`. */
export function linesWithHash(source: string, hash: string): number[] {
  return source
    .split("\n")
    .flatMap((text, index) => (anchorHashOf(text) === hash ? [index + 1] : []));
}

/** Of several candidate lines, the one nearest `near`; a tie goes to the earlier line. */
export function nearestLine(
  candidates: readonly number[],
  near: number,
): number | null {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort(
    (first, second) =>
      Math.abs(first - near) - Math.abs(second - near) || first - second,
  )[0];
}
