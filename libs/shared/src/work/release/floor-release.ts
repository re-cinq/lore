// Starts one repository's release on the floor's release line (specs/scheduled-releases): by the release tick on a repository's schedule, or by hand from the Release now button.
import type { FloorClient, StartedRun } from "@re-cinq/floor-client";
import { floorRepoOf, valueItem } from "../../outbound/floor/floor-items.js";
import { startLine } from "../review/floor-line-start.js";

const RELEASE_LINE = "release";

export type ReleaseLineStarter = Pick<FloorClient["lines"], "start">;

export interface ReleaseHead {
  repo: string;
  sha: string;
}

/** Keyed on the repo and its head commit, so a second start for the same commit joins the open run instead of starting another. */
export function startRelease(
  lines: ReleaseLineStarter,
  { repo, sha }: ReleaseHead,
): Promise<StartedRun> {
  return startLine(lines, RELEASE_LINE, {
    repo: floorRepoOf(repo),
    startItems: {
      release_key: valueItem(`${repo}:${sha}`),
      release_repo: valueItem(repo),
    },
  });
}
