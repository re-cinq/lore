import {
  ownersOfPath,
  type CodeownersRow,
} from "@re-cinq/lore-shared/codeowners.js";

export const APPROVED_PATH = "CLAUDE.md";

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
