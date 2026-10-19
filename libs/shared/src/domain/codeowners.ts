// A repository's CODEOWNERS file: its rows, and who owns a path under GitHub's rules (the last matching row wins).

import { minimatch } from "minimatch";

export type CodeownersRow = { pattern: string; owners: string[] };

/** Where GitHub looks for the file, in the order it looks: the first one present is the only one read. */
export const CODEOWNERS_PATHS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];

export function parseCodeowners(text: string): CodeownersRow[] {
  const out: CodeownersRow[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();

    if (!line) {
      continue;
    }
    const tokens = line.split(/\s+/);

    out.push({
      pattern: tokens[0],
      owners: tokens.slice(1),
    });
  }

  return out;
}

export function ownersOfPath(
  path: string,
  codeowners: CodeownersRow[],
): string[] {
  let owners: string[] = [];

  for (const row of codeowners) {
    if (patternMatchesPath(row.pattern, path)) {
      owners = row.owners;
    }
  }

  return owners;
}

/** A pattern holding a `/` anywhere but its end is anchored at the root; any other matches at any depth. One ending in `/` names a directory and owns everything under it. */
function patternMatchesPath(pattern: string, path: string): boolean {
  const directory = pattern.endsWith("/");
  const trimmed = pattern.replace(/\/$/, "");
  const anchored = trimmed.includes("/");
  const glob = trimmed.replace(/^\//, "");
  const scoped = directory ? `${glob}/**` : glob;

  return minimatch(path, anchored ? scoped : `**/${scoped}`, { dot: true });
}
