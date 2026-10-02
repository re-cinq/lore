import { minimatch } from "minimatch";

export type CodeownersRow = { pattern: string; owners: string[] };

export const APPROVED_PATH = "CLAUDE.md";

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

function patternMatchesPath(pattern: string, path: string): boolean {
  if (pattern.endsWith("/")) {
    return false;
  }
  const anchored = pattern.startsWith("/") || pattern.includes("/");
  const glob = pattern.replace(/^\//, "");

  return minimatch(path, anchored ? glob : `**/${glob}`, { dot: true });
}

export function isCodeowner(
  login: string,
  codeowners: CodeownersRow[],
): boolean {
  const handle = (login.startsWith("@") ? login : "@" + login).toLowerCase();

  return ownersOfPath(APPROVED_PATH, codeowners).some(
    (owner) => owner.toLowerCase() === handle,
  );
}

export function isTeamOnlyOwners(owners: string[]): boolean {
  return owners.length > 0 && owners.every((o) => o.includes("/"));
}
