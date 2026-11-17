// Binds the pack catch-up to lore-api as this process reaches it (composition root).
import {
  postPackSync,
  loreApiTarget,
} from "../utopia-backfill-tick/lore-api-backfill.js";
import { packSyncTick } from "./pack-sync-tick.js";

export const NO_LORE_API =
  "no LORE_API_URL configured: the pack sync runs in lore-api";

export async function runPackSyncTick(): Promise<string> {
  const target = loreApiTarget();

  return target ? packSyncTick(() => postPackSync(target)) : NO_LORE_API;
}
