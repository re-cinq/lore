import { z } from "zod";

export const DB_UNAVAILABLE = "database unavailable";

export const repoFullName = z.string().regex(/^[^/\s]+\/[^/\s]+$/, "expected owner/name");

export const boolFlag = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform(v => v === true || v === "true" || v === "1");
