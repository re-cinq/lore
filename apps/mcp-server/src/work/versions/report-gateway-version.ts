import { createRequire } from "node:module";
import {
  readPackageVersions,
  serviceStart,
} from "@re-cinq/lore-shared/project/service-versions/package-versions.js";
import { proxyToApi } from "@re-cinq/lore-server-core/proxy.js";

/** The gateway holds no pool (ADR-032), so it reports its start to lore-api, which writes the lore-mcp row. Never called by the laptop adapter. A refused report is logged and the gateway serves on. */
export async function reportGatewayVersion(
  env: Partial<Record<"LORE_BUILD_SHA", string>>,
): Promise<void> {
  const { service, build, packages } = serviceStart(
    "lore-mcp",
    readPackageVersions(createRequire(import.meta.url), [
      "@modelcontextprotocol/sdk",
    ]),
    env,
  );
  const result = await proxyToApi("/api/service-versions", {
    service,
    build,
    packages,
  });

  if (!result.ok) {
    console.error(`[lore] could not report the gateway's version:`, result);
  }
}
