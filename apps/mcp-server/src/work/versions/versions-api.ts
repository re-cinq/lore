import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  proxyGetApi,
  type ProxyResult,
} from "@re-cinq/lore-server-core/proxy.js";

/** SHA the running laptop adapter was built from — written by lore-update.sh / install.sh; absent on the gateway. */
export const BUILD_MARKER = join(homedir(), ".lore", "mcp-build-head");

export function fetchVersions(): Promise<ProxyResult> {
  return proxyGetApi("/api/versions");
}

/** The deployed build lore_update installs, or null when lore-api cannot be asked. */
export async function latestBuild(): Promise<string | null> {
  const proxied = await fetchVersions();

  return proxied.ok
    ? ((JSON.parse(proxied.body) as { latest?: { build?: string } }).latest
        ?.build ?? null)
    : null;
}

export async function adapterBuild(): Promise<string | null> {
  const marker = await readFile(BUILD_MARKER, "utf8").catch(() => "");

  return marker.trim() || null;
}
