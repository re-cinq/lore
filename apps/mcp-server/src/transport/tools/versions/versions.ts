import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../shared/deps.js";
import { proxyRefusal } from "../shared/render-proxied.js";
import type { ApiAnswer } from "../../api/api-types.js";
import {
  adapterBuild,
  fetchVersions,
} from "../../../work/versions/versions-api.js";

/** lore-api's GET /api/versions answer: which build of every Lore part runs. */
export type LoreVersions = ApiAnswer<"/api/versions">;

export function registerVersionsTool(server: McpServer) {
  server.tool(
    "lore_versions",
    `Lists which build of every Lore part runs: lore-api, stations, the lore-mcp gateway and the web UI, the floor with each live cluster's agent and AI subsystem, the database migrations, the pipelines and agent definitions on the floor, and the agent image. On a laptop it also says whether this adapter is the latest build. Instead: lore_update to install the latest build.`,
    {},
    versionsHandler,
  );
}

async function versionsHandler() {
  const proxied = await fetchVersions();

  if (!proxied.ok) {
    return proxyRefusal(proxied, {
      op: "fetching versions",
      subject: "versions",
      toolName: "lore_versions",
    });
  }

  return textResult(
    renderVersions(
      JSON.parse(proxied.body) as LoreVersions,
      await adapterBuild(),
    ),
  );
}

type Failed = { error: string };
type Packages = Record<string, string>;

/** The answer as a short list, one part per line; `adapter` is this laptop adapter's build, null on the gateway. */
export function renderVersions(
  versions: LoreVersions,
  adapter: string | null,
): string {
  return [
    `Latest Lore build: ${versions.latest.build}`,
    ...serviceLines(versions.lore),
    ...floorLines(versions.floor),
    `- database: ${orError(versions.database, databaseText)}`,
    `- on the floor: ${orError(versions.onFloor, onFloorText)}`,
    `- agent image: ${versions.agentImage ?? "none"}`,
    ...adapterLines(adapter, versions.latest.build),
  ].join("\n");
}

function orError<T extends object>(
  part: T | Failed,
  text: (value: T) => string,
): string {
  return "error" in part ? `error: ${part.error}` : text(part);
}

function serviceLines(lore: LoreVersions["lore"]): string[] {
  return Object.entries(lore).map(
    ([name, part]) => `- ${name}: ${orError<ServicePart>(part, serviceText)}`,
  );
}

type ServicePart = { build: string; startedAt?: string; packages: Packages };

function serviceText(part: ServicePart): string {
  const started = part.startedAt ? `, started ${part.startedAt}` : "";

  return `${part.build}${started}${packagesText(part.packages)}`;
}

function packagesText(packages: Packages): string {
  const listed = Object.entries(packages).map(([name, v]) => `${name} ${v}`);

  return listed.length ? ` (${listed.join(", ")})` : "";
}

type FloorPart = Exclude<LoreVersions["floor"], Failed>;

function floorLines(floor: LoreVersions["floor"]): string[] {
  if ("error" in floor) {
    return [`- floor: error: ${floor.error}`];
  }

  return [
    `- floor: ${floor.build}, schema ${floor.schemaVersion}`,
    ...floor.clusters.map(clusterLine),
  ];
}

function clusterLine(cluster: FloorPart["clusters"][number]): string {
  return `  - cluster ${cluster.id}: floor agent ${cluster.build ?? "unknown"}, subsystem ${subsystemText(cluster.subsystem)}, seen ${cluster.lastSeenAt}`;
}

// The floor passes the subsystem's own versions through as it read them, so only the fields this list prints are trusted.
function subsystemText(subsystem: unknown): string {
  const { version, clis } = (subsystem ?? {}) as {
    version?: unknown;
    clis?: Packages;
  };

  return typeof version === "string"
    ? `${version}${packagesText(clis ?? {})}`
    : "unknown";
}

function databaseText(database: {
  migration: string | null;
  floorMigration: string | null;
}): string {
  return `${database.migration ?? "none"}, floor migrations ${database.floorMigration ?? "none"}`;
}

function onFloorText(onFloor: {
  pipelines: Array<{ id: string; hash: string | null }>;
  agentDefinitions: number;
}): string {
  const missing = onFloor.pipelines.flatMap((pipeline) =>
    pipeline.hash ? [] : [pipeline.id],
  );
  const gap = missing.length ? ` (missing: ${missing.join(", ")})` : "";

  return `${onFloor.pipelines.length} pipelines${gap}, ${onFloor.agentDefinitions} agent definitions`;
}

function adapterLines(adapter: string | null, latest: string): string[] {
  if (!adapter) {
    return [];
  }

  return adapter === latest
    ? [`- this adapter: ${adapter}, the latest`]
    : [`- this adapter: ${adapter}, behind ${latest}: run lore_update`];
}
