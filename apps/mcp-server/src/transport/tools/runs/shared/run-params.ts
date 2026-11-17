import { z } from "zod";

export const BLOB_HASH = /^sha256-[0-9a-f]{64}$/;

export const RUN_ID = z
  .string()
  .min(1)
  .describe("The run's id, from lore_list_runs or a run page URL.");
