import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.dark_factory_baseline` — the pre-feature 30-day counter snapshot a
 * repo's SC1/SC4/SC6 deltas are measured against (ADR-016).
 *
 * DDL: `scripts/infra/setup-dark-factory-schema.sh`. `counters` is an open
 * JSONB document rather than columns because the measured set is expected to
 * grow, and a baseline already captured must stay readable when it does.
 */

export const DarkFactoryBaselineSchema = z.object({
  id: z.string(),
  repo: z.string(),
  capturedAt: z.date(),
  windowStart: z.date(),
  windowEnd: z.date(),
  counters: z.record(z.unknown()),
});

export type DarkFactoryBaseline = z.infer<typeof DarkFactoryBaselineSchema>;

export const DARK_FACTORY_BASELINE_COLUMNS = {
  id: "id",
  repo: "repo",
  capturedAt: "captured_at",
  windowStart: "window_start",
  windowEnd: "window_end",
  counters: "counters",
} as const satisfies ColumnMap<DarkFactoryBaseline>;

export const DARK_FACTORY_BASELINE_TABLE = "pipeline.dark_factory_baseline";
