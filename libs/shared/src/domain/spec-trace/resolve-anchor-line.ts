// The line a spec link means in the file it cites: the line carrying its content hash, nearest the line it was written with. A link with no hash, or one whose hash the file no longer carries, means the line it was written with.
import { linesWithHash, nearestLine } from "../anchor-hash.js";

export interface AnchoredLink {
  line: number | null;
  hash: string | null;
}

export function resolveAnchorLine(
  link: AnchoredLink,
  source: string | null,
): number | null {
  if (source === null || link.hash === null) {
    return link.line;
  }

  return (
    nearestLine(linesWithHash(source, link.hash), link.line ?? 1) ?? link.line
  );
}
