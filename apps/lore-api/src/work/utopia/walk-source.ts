// What a cursor walk reads and writes through: the repo's GitHub reads, its settings and where the cursors are saved.

import { UtopiaMirrorSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import type { Pool } from "pg";

export interface WalkSource<Reads> {
  pool: Pool;
  repo: string;
  files: Reads;
  settings: { rawSettings(): Promise<Record<string, unknown> | null> };
}

export async function storedCursor(
  source: Pick<WalkSource<unknown>, "settings">,
  key: "commits_head" | "tracker_since",
): Promise<string | null> {
  const settings = await source.settings.rawSettings();
  const parsed = UtopiaMirrorSettingsSchema.safeParse(settings?.utopia);

  return parsed.success ? (parsed.data[key] ?? null) : null;
}
