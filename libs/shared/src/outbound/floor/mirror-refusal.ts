// A repository another repo names as its public mirror gets no assembly-line run: a start whose repository is one is refused before the floor sees it.
import type { FloorClient, Item, StartRun } from "@re-cinq/floor-client";
import { enforceTrue } from "../../lib/enforce.js";
import { loreRepoOf, parseGitRef, parsePullRequestUrl } from "./floor-items.js";

/** The `full_name` of the repo that publishes to `repo`, or null when nobody does. */
export type MirrorOwnerOf = (repo: string) => Promise<string | null>;

const PULL_REQUEST_ARGUMENT = "pr_url";
const REPO_ARGUMENT = /(^|_)repo$/;

/** Thrown for a start on a mirror, so a caller can tell it from a floor that failed; it names its own retry budget, since asking again changes nothing. */
export class MirrorRefusal extends Error {
  readonly maxAttempts = 1;
}

/** Every repository a start names: its `repo`, each git item, each `repo` or `*_repo` value and the pull request url. */
export function reposOfStart(starting: StartRun): string[] {
  const named = Object.entries(starting.startItems).flatMap(
    ([name, startItem]) => reposOfItem(name, startItem),
  );
  const own = starting.repo ? [loreRepoOf(starting.repo)] : [];

  return [...new Set([...own, ...named])];
}

function reposOfItem(name: string, startItem: Item): string[] {
  if (startItem.kind === "git") {
    return [parseGitRef(startItem.ref).repo];
  }

  if (startItem.kind !== "value") {
    return [];
  }

  if (name === PULL_REQUEST_ARGUMENT) {
    return [parsePullRequestUrl(startItem.ref).repo];
  }

  return REPO_ARGUMENT.test(name) ? [startItem.ref] : [];
}

export function withMirrorRefusal(
  client: FloorClient,
  ownerOf: MirrorOwnerOf,
): FloorClient {
  return {
    ...client,
    lines: {
      ...client.lines,
      start: async (lineId, starting) => {
        await refuseMirrors(ownerOf, starting);

        return client.lines.start(lineId, starting);
      },
    },
  };
}

async function refuseMirrors(
  ownerOf: MirrorOwnerOf,
  starting: StartRun,
): Promise<void> {
  const repos = reposOfStart(starting);
  const owners = await Promise.all(repos.map((repo) => ownerOf(repo)));
  const mirrored = repos.findIndex((_, index) => owners[index] !== null);

  enforceTrue(
    mirrored === -1,
    MirrorRefusal,
    `${repos[mirrored]} is the public mirror of ${owners[mirrored]}: the floor starts nothing for it`,
  );
}
