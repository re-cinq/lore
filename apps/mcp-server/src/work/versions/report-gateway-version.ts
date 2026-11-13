import { createRequire } from "node:module";
import {
  readPackageVersions,
  serviceStart,
} from "@re-cinq/lore-shared/project/service-versions/package-versions.js";
import { proxyToApi } from "@re-cinq/lore-server-core/proxy.js";

/** How often, and how many times, the gateway asks again: during a rollout it can start before the lore-api that serves the route. */
export interface ReportRetry {
  attempts: number;
  wait: () => Promise<void>;
}

const RETRY_EVERY_MS = 30_000;
const DEFAULT_RETRY: ReportRetry = {
  attempts: 20,
  wait: () => new Promise((resolve) => setTimeout(resolve, RETRY_EVERY_MS)),
};

/** The gateway holds no pool (ADR-032), so it reports its start to lore-api, which writes the lore-mcp row. Never called by the laptop adapter. A refused report is tried again, then logged, and the gateway serves on. */
export async function reportGatewayVersion(
  env: Partial<Record<"LORE_BUILD_SHA", string>>,
  retry: ReportRetry = DEFAULT_RETRY,
): Promise<void> {
  const { service, build, packages } = serviceStart(
    "lore-mcp",
    readPackageVersions(createRequire(import.meta.url), [
      "@modelcontextprotocol/sdk",
    ]),
    env,
  );

  await postUntilAccepted({ service, build, packages }, retry);
}

async function postUntilAccepted(
  report: Record<string, unknown>,
  retry: ReportRetry,
): Promise<void> {
  for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
    const result = await proxyToApi("/api/service-versions", report);

    if (result.ok) {
      return;
    }

    if (attempt === retry.attempts) {
      console.error(`[lore] could not report the gateway's version:`, result);

      return;
    }

    await retry.wait();
  }
}
