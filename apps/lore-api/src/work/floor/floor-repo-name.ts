import {
  githubHost,
  githubHostPattern,
} from "@re-cinq/lore-shared/github-host.js";

/** A floor repository `host/owner/name` as Lore's `owner/name`; a name on another host stays as it is. */
export function withoutHostPrefix(
  floorRepo: string,
  host: string = githubHost(),
): string {
  return floorRepo.replace(new RegExp(`^${githubHostPattern(host)}/`), "");
}
