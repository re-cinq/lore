import { idParam } from "../../shared/api-segment.js";

export const BLOB_HASH = /^sha256-[0-9a-f]{64}$/;

export const RUN_ID = idParam.describe(
  "The run's id, from lore_list_runs or a run page URL.",
);
