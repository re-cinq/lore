import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export type Mode =
  { kind: "local"; apiUrl: string } | { kind: "remote"; apiUrl: string };

const LOCAL_API_URL = "http://localhost:3001";
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "host.docker.internal",
]);

export function resolveMode(env: Record<string, string | undefined>): Mode {
  const configuredUrl = env.LORE_API_URL;

  if (!configuredUrl) {
    return { kind: "local", apiUrl: LOCAL_API_URL };
  }
  enforceTrue(
    URL.canParse(configuredUrl),
    Error,
    `LORE_API_URL is not a valid URL: "${configuredUrl}"`,
  );
  const isLocalHost = LOCAL_HOSTNAMES.has(new URL(configuredUrl).hostname);

  return isLocalHost
    ? { kind: "local", apiUrl: LOCAL_API_URL }
    : { kind: "remote", apiUrl: configuredUrl.replace(/\/+$/, "") };
}

export function defaultsFor(mode: Mode): Record<string, string> {
  if (mode.kind === "remote") {
    return {};
  }

  return {
    LORE_DB_HOST: "localhost",
    LORE_DB_PORT: "5432",
    LORE_DB_NAME: "lore",
    LORE_DB_USER: "postgres",
    LORE_DB_PASSWORD: "lore",
    LORE_API_URL: mode.apiUrl,
    LORE_UI_URL: "http://localhost:3000",
    LORE_INGEST_TOKEN: "lore-local-dev-token",
  };
}
