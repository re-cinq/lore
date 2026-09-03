import { z } from "zod";

export const DB_UNAVAILABLE = "database unavailable";

export const repoFullName = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/, "expected owner/name");

export const MAX_PAGE_LIMIT = 100;

// Clamp-not-reject over-max (historical behavior); coerce string query params.
export const clampedLimit = z.coerce
  .number()
  .int()
  .positive()
  .transform((n) => Math.min(n, MAX_PAGE_LIMIT));
export const offsetParam = z.coerce.number().int().min(0).default(0);

export const boolFlag = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === "true" || v === "1");
