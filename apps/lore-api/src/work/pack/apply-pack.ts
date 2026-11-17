import { isDeepStrictEqual } from "node:util";
import type { Pipeline, Put } from "@re-cinq/floor-pipeline";
import type { PackSyncState } from "@re-cinq/lore-shared";
import type { FloorAgentSettings } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import type { FetchedPack } from "./fetch-pack.js";
import type { PackConfig } from "@re-cinq/lore-shared/pack-config.js";
import { agentFileOf, pipelineFolderOf } from "./pack-paths.js";
import { settingsWithEnvironment } from "../floor/seed-floor-pipelines.js";
import {
  packOverlay,
  type PackOverlay,
  type ShippedCatalog,
} from "./pack-loader.js";

export interface PackDeps {
  /** Null when the install has no pack. */
  config: PackConfig | null;
  env: Record<string, string | undefined>;
  now(): Date;
  fetch(): Promise<FetchedPack>;
  shipped(): Promise<ShippedCatalog>;
  /** The org default the floor holds for the agent, or null. */
  floorAgent(name: string): Promise<FloorAgentSettings | null>;
  /** Writes the org default only: a repository's variant of the agent stays. */
  putAgent(name: string, settings: FloorAgentSettings): Promise<void>;
  importPipeline(pipeline: Pipeline): Promise<Put[]>;
  archivePipeline(name: string): Promise<void>;
  readSync(): Promise<PackSyncState | null>;
  writeSync(state: PackSyncState): Promise<void>;
}

export type PackApplyResult =
  | { status: "unconfigured" }
  | { status: "applied"; commit: string; changed: string[] }
  | { status: "failed"; error: string };

/** Never throws: a pack that cannot be read, or a floor that refuses, is recorded in `pack.sync` and the floor keeps what it holds. An unreachable pack is not an empty one, so nothing is archived or reverted on a failure. */
export async function applyPack(deps: PackDeps): Promise<PackApplyResult> {
  if (!deps.config) {
    return { status: "unconfigured" };
  }
  const previous = await deps.readSync();

  try {
    return await applyFetched(deps, deps.config, previous);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);

    await deps.writeSync({
      ...(previous ?? firstSync(deps.config)),
      error,
      error_at: deps.now().toISOString(),
    });

    return { status: "failed", error };
  }
}

function firstSync(config: PackConfig): PackSyncState {
  return {
    repo: config.repo,
    ref: config.ref ?? null,
    commit: null,
    applied_at: null,
    agent_count: 0,
    line_count: 0,
    extra_count: 0,
    refused_files: [],
    agents: [],
    pipelines: [],
    error: null,
    error_at: null,
  };
}

async function applyFetched(
  deps: PackDeps,
  config: PackConfig,
  previous: PackSyncState | null,
): Promise<PackApplyResult> {
  const pack = await deps.fetch();
  const shipped = await deps.shipped();
  const overlay = packOverlay({ files: pack.files, shipped, env: deps.env });
  const dropped = droppedBy(overlay, previous);
  const changed = [
    ...(await putAgents(deps, overlay, dropped.agents, shipped)),
    ...(await importPipelines(deps, overlay.pipelines)),
    ...(await archivePipelines(deps, dropped.pipelines)),
  ];

  await deps.writeSync(syncStateOf(deps, { config, pack, overlay, dropped }));

  return { status: "applied", commit: pack.commit, changed };
}

/** The pack's agents, then the shipped definition of each agent the pack no longer sets, as `agent/<name>` for each put. */
async function putAgents(
  deps: PackDeps,
  overlay: PackOverlay,
  reverted: string[],
  shipped: ShippedCatalog,
): Promise<string[]> {
  const set = [...overlay.agents].map(
    ([name, agent]) => [name, agent.settings] as const,
  );
  const changed: string[] = [];

  for (const [name, settings] of [
    ...set,
    ...shippedAgents(deps, reverted, shipped),
  ]) {
    if (await putIfDiffers(deps, name, settings)) {
      changed.push(`agent/${name}`);
    }
  }

  return changed;
}

function shippedAgents(
  deps: PackDeps,
  names: string[],
  shipped: ShippedCatalog,
) {
  return names.flatMap((name) => {
    const settings = shipped.agents.get(name);

    return settings
      ? [[name, settingsWithEnvironment(settings, deps.env)] as const]
      : [];
  });
}

async function importPipelines(
  deps: PackDeps,
  pipelines: Pipeline[],
): Promise<string[]> {
  const puts = await Promise.all(
    pipelines.map((pipeline) => deps.importPipeline(pipeline)),
  );

  return puts
    .flat()
    .filter((put) => put.changed)
    .map((put) => `${put.kind}/${put.id}`);
}

async function archivePipelines(
  deps: PackDeps,
  names: string[],
): Promise<string[]> {
  await Promise.all(names.map((name) => deps.archivePipeline(name)));

  return names.map((name) => `archived/${name}`);
}

interface Applied {
  config: PackConfig;
  pack: FetchedPack;
  overlay: PackOverlay;
  dropped: ReturnType<typeof droppedBy>;
}

function syncStateOf(
  deps: PackDeps,
  { config, pack, overlay, dropped }: Applied,
): PackSyncState {
  const lineIds = overlay.pipelines.map((pipeline) => pipeline.line?.id ?? "");

  return {
    repo: config.repo,
    ref: config.ref ?? null,
    commit: pack.commit,
    applied_at: deps.now().toISOString(),
    agent_count: overlay.counts.agents,
    line_count: overlay.counts.pipelines,
    extra_count: overlay.counts.extensions,
    refused_files: overlay.refused,
    agents: [...overlay.agents.keys(), ...dropped.keptAgents].sort(),
    pipelines: [...lineIds, ...dropped.keptPipelines].sort(),
    error: null,
    error_at: null,
  };
}

/** What the last sync set that this pack no longer names. A name whose file the pack still holds, only malformed, is kept: a typo must not revert an agent or archive a pipeline. */
function droppedBy(overlay: PackOverlay, previous: PackSyncState | null) {
  const refusedAgents = new Set(
    overlay.refused.flatMap((file) => agentFileOf(file.path)?.agent ?? []),
  );
  const refusedPipelines = new Set(
    overlay.refused.flatMap((file) => pipelineFolderOf(file.path) ?? []),
  );
  const agents = (previous?.agents ?? []).filter(
    (name) => !overlay.agents.has(name),
  );
  const pipelines = (previous?.pipelines ?? []).filter(
    (name) => !overlay.pipelines.some((pipeline) => pipeline.line?.id === name),
  );

  return {
    agents: agents.filter((name) => !refusedAgents.has(name)),
    keptAgents: agents.filter((name) => refusedAgents.has(name)),
    pipelines: pipelines.filter((name) => !refusedPipelines.has(name)),
    keptPipelines: pipelines.filter((name) => refusedPipelines.has(name)),
  };
}

async function putIfDiffers(
  deps: PackDeps,
  name: string,
  settings: FloorAgentSettings,
): Promise<boolean> {
  const held = await deps.floorAgent(name);

  if (held && sameSettings(held, settings)) {
    return false;
  }
  await deps.putAgent(name, settings);

  return true;
}

// The settings a run reads. Prices are left out: the floor keeps them under other names, and an unchanged put is no new version anyway.
function sameSettings(
  held: FloorAgentSettings,
  wanted: FloorAgentSettings,
): boolean {
  return isDeepStrictEqual(runSettings(held), runSettings(wanted));
}

function runSettings({ prices: _prices, ...settings }: FloorAgentSettings) {
  return JSON.parse(JSON.stringify(settings)) as unknown;
}
