import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { mintApiToken, revokeTokenByHash } from "./mint-token.js";

function poolReturning(row: Record<string, unknown>) {
  const query = vi.fn().mockResolvedValue({ rows: [row] });

  return { query, pool: { query } as unknown as Pool };
}

describe("mintApiToken", () => {
  it("stores the sha256 of the raw token it returns", async () => {
    const { query, pool } = poolReturning({
      id: "id-1",
      name: "ci",
      scopes: ["read"],
      created_at: "now",
    });

    const minted = await mintApiToken(pool, {
      name: "ci",
      scopes: ["read"],
      createdBy: "admin",
      expiresAt: null,
    });

    expect(minted.token).toMatch(/^lore_[0-9a-f]{64}$/);
    expect(query.mock.calls[0][1][1]).toBe(
      createHash("sha256").update(minted.token).digest("hex"),
    );
  });

  it("stores a service token with no person on it", async () => {
    const { query, pool } = poolReturning({ id: "id-1" });

    await mintApiToken(pool, {
      name: "ci",
      scopes: ["read"],
      createdBy: "admin",
      expiresAt: null,
    });

    expect(query.mock.calls[0][1]).toEqual([
      "ci",
      expect.any(String),
      ["read"],
      "admin",
      null,
      "service",
      null,
      null,
      null,
      [],
    ]);
  });

  it("stores a user token with the person's login, name, avatar and repos", async () => {
    const { query, pool } = poolReturning({ id: "id-1" });
    const expiresAt = new Date("2026-10-28T20:00:00Z");

    await mintApiToken(pool, {
      name: "web-ui session gedaiu",
      scopes: ["read", "write"],
      createdBy: "gedaiu",
      expiresAt,
      kind: "user",
      user: {
        login: "gedaiu",
        displayName: "Bogdan",
        avatarUrl: "https://a/1",
        repos: ["re-cinq/lore"],
      },
    });

    expect(query.mock.calls[0][1]).toEqual([
      "web-ui session gedaiu",
      expect.any(String),
      ["read", "write"],
      "gedaiu",
      expiresAt,
      "user",
      "gedaiu",
      "Bogdan",
      "https://a/1",
      ["re-cinq/lore"],
    ]);
  });

  it("returns the inserted row beside the raw token", async () => {
    const row = { id: "id-1", name: "ci", scopes: ["read"], created_at: "now" };
    const { pool } = poolReturning(row);

    const minted = await mintApiToken(pool, {
      name: "ci",
      scopes: ["read"],
      createdBy: "admin",
      expiresAt: null,
    });

    expect(minted.row).toEqual(row);
  });
});

describe("revokeTokenByHash", () => {
  it("revokes the live token with that hash", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });

    await revokeTokenByHash({ query } as unknown as Pool, "hash-1");

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE pipeline\.api_tokens SET revoked_at = now\(\)[\s\S]*token_hash = \$1/,
      ),
      ["hash-1"],
    );
  });
});
