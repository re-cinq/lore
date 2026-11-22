import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../deploy/chart/charts/ui-helm/migrations/0140_user_session_token_expiries.sql",
  ),
  "utf-8",
);

describe("migration 0140, the expiries of a session's stored tokens", () => {
  it("adds the access token's and the refresh token's expiry to the stored token row", () => {
    expect({
      access:
        /ALTER TABLE pipeline\.user_session_tokens[\s\S]*ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ/.test(
          sql,
        ),
      refresh:
        /ALTER TABLE pipeline\.user_session_tokens[\s\S]*ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ/.test(
          sql,
        ),
    }).toEqual({ access: true, refresh: true });
  });

  it("adds both expiries to the sign-in handoff rows", () => {
    expect({
      access:
        /ALTER TABLE lore\.login_handoffs[\s\S]*ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ/.test(
          sql,
        ),
      refresh:
        /ALTER TABLE lore\.login_handoffs[\s\S]*ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ/.test(
          sql,
        ),
    }).toEqual({ access: true, refresh: true });
  });
});
