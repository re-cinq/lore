import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { ServiceVersion } from "../../../domain/models/service-version.js";
import type { ServiceVersionsPort } from "./service-versions-port.js";

export const FLOOR_CLIENT = "@re-cinq/floor-client";

interface PackageManifest {
  version?: string;
}

/** The version of each named package as `required` resolves it (pass `createRequire(import.meta.url)` of the module that imports them); a package that does not resolve is left out. */
export function readPackageVersions(
  required: NodeJS.Require,
  names: string[],
): Record<string, string> {
  const found = names.map((name) => [name, versionOf(required, name)]);

  return Object.fromEntries(
    found.filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

// Node's own lookup path for the name, searched for the package's manifest: an exports map may hide both package.json and a root entry.
function versionOf(required: NodeJS.Require, name: string): string | null {
  const manifest = (required.resolve.paths(name) ?? [])
    .map((dir) => join(dir, name, "package.json"))
    .find(existsSync);

  return manifest
    ? ((JSON.parse(readFileSync(manifest, "utf8")) as PackageManifest)
        .version ?? null)
    : null;
}

/** A service and libs/shared can each resolve their own floor-client copy: when libs/shared's differs from the service's, it is reported beside it as `@re-cinq/floor-client (libs/shared)`. */
export function withSharedFloorClient(
  packages: Record<string, string>,
): Record<string, string> {
  const shared = readPackageVersions(createRequire(import.meta.url), [
    FLOOR_CLIENT,
  ])[FLOOR_CLIENT];

  return shared && shared !== packages[FLOOR_CLIENT]
    ? { ...packages, [`${FLOOR_CLIENT} (libs/shared)`]: shared }
    : packages;
}

/** The row a service writes when it starts: its image's LORE_BUILD_SHA, or "dev" outside an image. */
export function serviceStart(
  service: string,
  packages: Record<string, string>,
  env: Partial<Record<"LORE_BUILD_SHA", string>> = process.env,
  now: Date = new Date(),
): ServiceVersion {
  return {
    service,
    build: env.LORE_BUILD_SHA || "dev",
    packages,
    startedAt: now,
  };
}

/** Writes a service's start; a failed write is logged and the service boots on, shown as unreported by GET /api/versions. */
export async function recordServiceStart(
  versions: ServiceVersionsPort,
  start: ServiceVersion,
): Promise<void> {
  try {
    await versions.record(start);
  } catch (err) {
    console.error(`[${start.service}] failed to record its version:`, err);
  }
}
