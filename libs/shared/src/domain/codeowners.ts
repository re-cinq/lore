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

/** A repository's CODEOWNERS rows: GitHub reads only the first CODEOWNERS present, and with none no path has an owner. `read` answers a file's text, or null where it is absent. */
export async function codeownersOf(repo: {
  read(path: string): Promise<string | null>;
}): Promise<CodeownersRow[]> {
  const texts = await Promise.all(
    CODEOWNERS_PATHS.map((path) => repo.read(path)),
  );

  return parseCodeowners(texts.find((text) => text !== null) ?? "");
}

/** The paths among `files` a CODEOWNERS row gives an owner: the ones a code owner must approve. */
export function ownedPaths(
  files: readonly string[],
  codeowners: CodeownersRow[],
): string[] {
  return files.filter((path) => ownersOfPath(path, codeowners).length > 0);
}
