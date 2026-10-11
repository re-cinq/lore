import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.live_tokens` — a short-lived token that opens one subject of the live socket (a `run` token opens one assembly run's channel, a `runs` token the external floor's run list) as one person; only its sha256 is stored. */

/** The one subject of a `runs` token: the external floor's run list. */
export const LIVE_RUNS_SUBJECT = "floor";

export const LIVE_TOKEN_TABLE = "lore.live_tokens";

export const LiveTokenSchema = z.object({
  tokenHash: z.string(),
  kind: z.enum(["run", "runs"]),
  subject: z.string(),
  userId: z.string(),
  userName: z.string(),
  expiresAt: z.date(),
});

export type LiveToken = z.infer<typeof LiveTokenSchema>;

export const LIVE_TOKEN_COLUMNS = {
  tokenHash: "token_hash",
  kind: "kind",
  subject: "subject",
  userId: "user_id",
  userName: "user_name",
  expiresAt: "expires_at",
} as const satisfies ColumnMap<LiveToken>;
