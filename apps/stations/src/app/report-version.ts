import { createRequire } from "node:module";
import type { ServiceVersionsPort } from "@re-cinq/lore-shared/project/service-versions/service-versions-port.js";
import {
  readPackageVersions,
  recordServiceStart,
  serviceStart,
  withSharedFloorClient,
} from "@re-cinq/lore-shared/project/service-versions/package-versions.js";

const BUNDLED = ["@re-cinq/floor-client", "@re-cinq/floor-station"];

/** The stations service's row in lore.service_versions, written once its pool is up. */
export async function reportStationsVersion(
  versions: ServiceVersionsPort,
  env: Partial<Record<"LORE_BUILD_SHA", string>> = process.env,
): Promise<void> {
  const packages = withSharedFloorClient(
    readPackageVersions(createRequire(import.meta.url), BUNDLED),
  );

  await recordServiceStart(versions, serviceStart("stations", packages, env));
}
