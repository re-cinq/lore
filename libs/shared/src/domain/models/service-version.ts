import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.service_versions` — the build a Lore service runs, one row per service, rewritten every time it starts. `packages` maps a bundled package's name to its version. */

export const SERVICE_VERSION_TABLE = "lore.service_versions";

export const ServiceVersionSchema = z.object({
  service: z.string(),
  build: z.string(),
  packages: z.record(z.string(), z.string()),
  startedAt: z.date(),
});

export type ServiceVersion = z.infer<typeof ServiceVersionSchema>;

export const SERVICE_VERSION_COLUMNS = {
  service: "service",
  build: "build",
  packages: "packages",
  startedAt: "started_at",
} as const satisfies ColumnMap<ServiceVersion>;
