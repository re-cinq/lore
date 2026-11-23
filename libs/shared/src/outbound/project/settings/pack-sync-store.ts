import type { Pool } from "pg";
import { packConfig } from "../../../domain/pack-config.js";
import { enforceTrue } from "../../../lib/enforce.js";
import {
  PACK_SYNC_KEY,
  PackSyncStateSchema,
  type PackSyncState,
} from "../../../domain/models/pack-sync-state.js";

/** The stored `pack.sync` text as a state, or null when no sync has run. */
export function parsePackSync(value: string | null): PackSyncState | null {
  if (value === null) {
    return null;
  }
  const parsed = PackSyncStateSchema.safeParse(JSON.parse(value));

  enforceTrue(
    parsed.success,
    Error,
    "lore.settings pack.sync is not a pack sync state",
  );

  return parsed.data;
}

export async function readPackSync(pool: Pool): Promise<PackSyncState | null> {
  const { rows } = await pool.query<{ value: string }>(
    "SELECT value FROM lore.settings WHERE key = $1",
    [PACK_SYNC_KEY],
  );

  return parsePackSync(rows[0]?.value ?? null);
}

export async function writePackSync(
  pool: Pool,
  state: PackSyncState,
): Promise<void> {
  await pool.query(
    `INSERT INTO lore.settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [PACK_SYNC_KEY, JSON.stringify(PackSyncStateSchema.parse(state))],
  );
}

/** The agents, pipelines or skills the last sync set, while the install reads a pack; none once LORE_PACK_REPO is unset, whatever the last sync recorded. */
export async function packManagedNames(
  pool: Pool | null,
  kind: "agents" | "pipelines" | "skills",
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  if (!pool || !packConfig(env)) {
    return [];
  }

  return (await readPackSync(pool))?.[kind] ?? [];
}
