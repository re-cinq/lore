import { hostname } from "node:os";
import type { Pool } from "pg";
import type { FloorClient } from "@re-cinq/floor-client";
import { importPipeline, readPipelineFile } from "@re-cinq/floor-pipeline";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorClientFrom } from "@re-cinq/lore-shared/floor/floor-client.js";
import { DbLeaseBackend } from "@re-cinq/lore-shared/project/leases/lease-backends.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { shippedFloorAgents } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import {
  readPackSync,
  writePackSync,
} from "@re-cinq/lore-shared/project/settings/pack-sync-store.js";
import { readFloorPipelineFiles } from "../floor/seed-floor-pipelines.js";
import type { PackDeps } from "./apply-pack.js";
import { fetchPack, type PackReader } from "./fetch-pack.js";
import { agentBodyOf, packSettingsOf } from "./floor-agent-settings.js";
import { packConfig } from "./pack-config.js";
import { syncPack, type PackSyncResult } from "./sync-pack.js";

type Env = Record<string, string | undefined>;

export function productionPackDeps(
  pool: Pool,
  env: Env = process.env,
): PackDeps {
  return {
    config: packConfig(env),
    env,
    now: () => new Date(),
    fetch: () => fetchPack(githubPackReader(env), packConfigOf(env)),
    shipped: shippedCatalog,
    ...floorPorts(env),
    readSync: () => readPackSync(pool),
    writeSync: (state) => writePackSync(pool, state),
  };
}

/** The sync a boot, a push, a tick or a button runs: under the lease, so one replica applies at a time. */
export function syncProductionPack(
  pool: Pool,
  env: Env = process.env,
): Promise<PackSyncResult> {
  return syncPack(
    productionPackDeps(pool, env),
    new DbLeaseBackend(pool),
    `${hostname()}:${process.pid}`,
  );
}

function packConfigOf(env: Env) {
  const config = packConfig(env);

  enforceTrue(config, Error, "LORE_PACK_REPO is not set");

  return config;
}

function floorPorts(
  env: Env,
): Pick<
  PackDeps,
  "floorAgent" | "putAgent" | "importPipeline" | "archivePipeline"
> {
  const floor = floorClientFrom(env);
  const access = {
    url: env.FLOOR_API_URL ?? "",
    token: env.FLOOR_SERVICE_TOKEN ?? "",
  };

  return {
    ...agentPorts(floor.agentDefinitions),
    importPipeline: (pipeline) => importPipeline(access, pipeline),
    archivePipeline: (name) => floor.lines.archive(name),
  };
}

function agentPorts(
  definitions: FloorClient["agentDefinitions"],
): Pick<PackDeps, "floorAgent" | "putAgent"> {
  return {
    floorAgent: async (name) => {
      const held = await definitions.get(name);

      return held && packSettingsOf(held.body.settings);
    },
    // The body is read first and written back whole, so a repository's variant of the agent stays.
    putAgent: async (name, settings) => {
      const held = await definitions.get(name);

      await definitions.put(name, agentBodyOf(held?.body, settings));
    },
  };
}

function githubPackReader(env: Env): PackReader {
  const github = new PlatformGitHub(env);

  return {
    headCommit: async (repo, ref) =>
      github.branchHeadSha(repo, ref ?? (await github.getDefaultBranch(repo))),
    tree: (repo, commit) => github.listTree(repo, commit),
    fileText: async (repo, path, commit) => {
      const text = await github.getFileContent(repo, path, commit);

      enforceTrue(
        text !== null,
        Error,
        `${repo}: cannot read ${path} at ${commit}`,
      );

      return text;
    },
  };
}

async function shippedCatalog() {
  const files = await readFloorPipelineFiles();

  return {
    pipelines: files.map((file) => readPipelineFile(file.text).line?.id ?? ""),
    agents: shippedFloorAgents(),
  };
}
