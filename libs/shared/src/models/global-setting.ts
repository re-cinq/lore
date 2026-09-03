import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** Org-wide key/value settings; value is TEXT even when structured; per-repo settings in repo-settings.ts. */

export const GlobalSettingSchema = z.object({
  key: z.string(),
  value: z.string(),
  updatedAt: z.date(),
});

export type GlobalSetting = z.infer<typeof GlobalSettingSchema>;

export const GLOBAL_SETTING_COLUMNS = {
  key: "key",
  value: "value",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<GlobalSetting>;

export const GLOBAL_SETTING_TABLE = "lore.settings";
