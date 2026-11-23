import type { PackSyncState } from "@re-cinq/lore-shared";
import type { PackOverlay } from "./pack-loader.js";
import { agentFileOf, pipelineFolderOf, skillFileOf } from "./pack-paths.js";

interface Dropped {
  /** Named by the last sync, absent from the pack now. */
  dropped: string[];
  /** Absent from the overlay, but the pack still holds its file, only malformed. */
  kept: string[];
}

/** What the last sync set that this pack no longer names. A name whose file the pack still holds, only malformed, is kept: a typo must not revert an agent, archive a pipeline or delete a skill. */
export function droppedBy(
  overlay: PackOverlay,
  previous: PackSyncState | null,
) {
  const agents = agentsDropped(overlay, previous);
  const pipelines = pipelinesDropped(overlay, previous);
  const skills = skillsDropped(overlay, previous);

  return {
    agents: agents.dropped,
    keptAgents: agents.kept,
    pipelines: pipelines.dropped,
    keptPipelines: pipelines.kept,
    skills: skills.dropped,
    keptSkills: skills.kept,
  };
}

function agentsDropped(overlay: PackOverlay, previous: PackSyncState | null) {
  return dropOf(
    previous?.agents,
    (name) => overlay.agents.has(name),
    refusedNames(overlay, (path) => agentFileOf(path)?.agent),
  );
}

function pipelinesDropped(
  overlay: PackOverlay,
  previous: PackSyncState | null,
) {
  return dropOf(
    previous?.pipelines,
    (name) => overlay.lineIds.includes(name),
    refusedNames(overlay, pipelineFolderOf),
  );
}

function skillsDropped(overlay: PackOverlay, previous: PackSyncState | null) {
  return dropOf(
    previous?.skills,
    (name) => overlay.skills.has(name),
    refusedNames(overlay, skillFileOf),
  );
}

function refusedNames(
  overlay: PackOverlay,
  nameOf: (path: string) => string | undefined,
): Set<string> {
  return new Set(overlay.refused.flatMap((file) => nameOf(file.path) ?? []));
}

function dropOf(
  previous: string[] | undefined,
  isPresent: (name: string) => boolean,
  refused: ReadonlySet<string>,
): Dropped {
  const absent = (previous ?? []).filter((name) => !isPresent(name));

  return {
    dropped: absent.filter((name) => !refused.has(name)),
    kept: absent.filter((name) => refused.has(name)),
  };
}
