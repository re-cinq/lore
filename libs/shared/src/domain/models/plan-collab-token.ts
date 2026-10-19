import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.plan_collab_tokens` — a short-lived token that opens one plan's collaboration socket as one person; only its sha256 is stored. */

export const PLAN_COLLAB_TOKEN_TABLE = "lore.plan_collab_tokens";

export const PlanCollabTokenSchema = z.object({
  tokenHash: z.string(),
  planId: z.string(),
  repo: z.string(),
  userId: z.string(),
  userName: z.string(),
  role: z.enum(["read", "write"]),
  expiresAt: z.date(),
});

export type PlanCollabToken = z.infer<typeof PlanCollabTokenSchema>;

export const PLAN_COLLAB_TOKEN_COLUMNS = {
  tokenHash: "token_hash",
  planId: "plan_id",
  repo: "repo",
  userId: "user_id",
  userName: "user_name",
  role: "role",
  expiresAt: "expires_at",
} as const satisfies ColumnMap<PlanCollabToken>;
