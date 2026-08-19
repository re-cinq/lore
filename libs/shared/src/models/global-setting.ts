import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `lore.settings` — org-wide key/value settings (api_url, ingest_token,
 * approval_config).
 *
 * DDL: `scripts/infra/setup-repos-schema.sh`. `value` is TEXT even when the
 * setting is structured: the callers that store JSON here stringify it, and the
 * column has never been typed otherwise. Per-repo settings live in
 * `lore.repos.settings` — see `repo-settings.ts`.
 */

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
