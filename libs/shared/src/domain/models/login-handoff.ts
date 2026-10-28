import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/* `lore.login_handoffs` — the one-time rows of the GitHub sign-in lore-api runs for the web UI: a `state` row binds the GitHub round trip to the page that started it, a `redeem` row holds the signed-in person until the web UI swaps its code for a session token. Only the sha256 of the code is stored, and taking a row deletes it. */

export const UserGrantSchema = z.object({
  login: z.string(),
  name: z.string(),
  avatarUrl: z.string(),
  scopes: z.array(z.string()),
  repos: z.array(z.string()),
});

export type UserGrant = z.infer<typeof UserGrantSchema>;

export const LOGIN_HANDOFF_TABLE = "lore.login_handoffs";

export const LoginHandoffSchema = z.object({
  codeHash: z.string(),
  phase: z.enum(["state", "redeem"]),
  returnUrl: z.string(),
  grant: UserGrantSchema.nullable(),
  expiresAt: z.date(),
});

export type LoginHandoff = z.infer<typeof LoginHandoffSchema>;

export const LOGIN_HANDOFF_COLUMNS = {
  codeHash: "code_hash",
  phase: "phase",
  returnUrl: "return_url",
  grant: "grant_json",
  expiresAt: "expires_at",
} as const satisfies ColumnMap<LoginHandoff>;
