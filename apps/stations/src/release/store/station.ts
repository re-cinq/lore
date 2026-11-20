// Records a published release in the release store from the external floor (specs/scheduled-releases): the row the Changelog tab draws, written with the agent's summary and the changes the run collected. Writing it again for the same repository and version updates the row, so a retried visit leaves one.
import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import type { ChangelogReleasesPort } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-port.js";
import { storeDeps } from "../deps.js";
import { absentNeedsReport } from "../needs.js";
import { releaseRow } from "./release-row.js";

const REQUIRED = [
  "release_repo",
  "release_version",
  "release_sha",
  "release_bump_kind",
  "range_to",
  "release_changes",
  "release_notes",
];

export function releaseStoreHandle(
  releases: Pick<ChangelogReleasesPort, "upsert">,
): Handle {
  return async ({ needs }, tools) =>
    absentNeedsReport(needs, REQUIRED) ?? (await store(releases, needs, tools));
}

async function store(
  releases: Pick<ChangelogReleasesPort, "upsert">,
  needs: Brief["needs"],
  tools: Tools,
): Promise<Report> {
  try {
    await releases.upsert(releaseRow(needs, await filesOf(tools)));

    return { outcome: "success" };
  } catch (err) {
    return { outcome: "failed", error: errorMessage(err) };
  }
}

async function filesOf(
  tools: Tools,
): Promise<{ changesFile: string; notes: string }> {
  const [changesFile, notes] = await Promise.all([
    tools.read("release_changes"),
    tools.read("release_notes"),
  ]);

  return {
    changesFile: changesFile.toString("utf8"),
    notes: notes.toString("utf8"),
  };
}

export function startReleaseStoreStation(): RunningStation {
  return defineStation("release-store", releaseStoreHandle(storeDeps()));
}
