import { createRequire } from "node:module";
import type { ServiceVersionsPort } from "@re-cinq/lore-shared/project/service-versions/service-versions-port.js";
import {
  readPackageVersions,
  recordServiceStart,
  serviceStart,
  withSharedFloorClient,
} from "@re-cinq/lore-shared/project/service-versions/package-versions.js";

const BUNDLED = [
  "@re-cinq/floor-client",
  "@re-cinq/floor-pipeline",
  "@re-cinq/planning-document",
  "@re-cinq/planning-sync",
  "@re-cinq/planning-yjs",
];

/** lore-api's row in lore.service_versions, written once it has migrated the floor. */
export async function reportLoreApiVersion(
  versions: ServiceVersionsPort,
  env: Partial<Record<"LORE_BUILD_SHA", string>> = process.env,
): Promise<void> {
  const packages = withSharedFloorClient(
    readPackageVersions(createRequire(import.meta.url), BUNDLED),
  );

  await recordServiceStart(versions, serviceStart("lore-api", packages, env));
}
