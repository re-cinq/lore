import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../../app/build-server.js";

const originalEnv = { ...process.env };
const FIXED_TIMESTAMP = new Date("2026-11-22T10:00:00.000Z");

describe("Emergency token minting refusal (FR-178)", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.GITHUB_ORG;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("refuses to mint an emergency token through POST /api/tokens", async () => {
    const { pool, insertedTokens } = createTokenPool();
    const server = buildServer(() => pool as never);

    const adminResponse = await server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
      payload: {
        name: "ops-emergency",
        kind: "emergency",
        scopes: ["admin"],
      },
    });
    const personResponse = await server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: "Bearer session-token" },
      payload: {
        name: "alice-emergency",
        kind: "emergency",
        scopes: ["admin"],
      },
    });

    expect({
      adminOutcome: clientRefusalOutcome(adminResponse.statusCode),
      personOutcome: clientRefusalOutcome(personResponse.statusCode),
      insertedTokens,
    }).toEqual({
      adminOutcome: "refused",
      personOutcome: "refused",
      insertedTokens: [],
    });
  });

  it("refuses an emergency mint with no credential or a made-up one and inserts nothing", async () => {
    const { pool, insertedTokens } = createTokenPool(null);
    const server = buildServer(() => pool as never);
    const payload = { name: "ops-emergency", kind: "emergency" };

    const anonymous = await server.inject({
      method: "POST",
      url: "/api/tokens",
      payload,
    });
    const madeUp = await server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: "Bearer not-a-real-token" },
      payload,
    });

    expect({
      anonymous: anonymous.statusCode,
      madeUp: madeUp.statusCode,
      insertedTokens,
    }).toEqual({ anonymous: 401, madeUp: 401, insertedTokens: [] });
  });

  it("refuses an emergency mint from a signed-in person without the admin scope and inserts nothing", async () => {
    const { pool, insertedTokens } = createTokenPool(["read", "write"]);
    const server = buildServer(() => pool as never);

    const response = await server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: "Bearer session-token" },
      payload: { name: "alice-emergency", kind: "emergency" },
    });

    expect({ status: response.statusCode, insertedTokens }).toEqual({
      status: 403,
      insertedTokens: [],
    });
  });
});

function createTokenPool(sessionScopes: string[] | null = ["admin"]) {
  const pool = makePool();
  const insertedTokens: string[] = [];

  pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("UPDATE pipeline.api_tokens SET last_used")) {
      return {
        rows: knownSessionRows(sessionScopes, [
          {
            id: "session-1",
            scopes: sessionScopes ?? [],
            kind: "user",
            login: "alice",
            displayName: "Alice",
            avatarUrl: null,
            repos: [],
            github_id: 987654,
            reposRefreshedAt: FIXED_TIMESTAMP,
            startedAt: FIXED_TIMESTAMP,
            membership_checked_at: FIXED_TIMESTAMP,
            expiresAt: null,
          },
        ]),
      };
    }

    if (sql.includes("INSERT INTO pipeline.api_tokens")) {
      const tokenName = String(params?.[0] ?? "");

      insertedTokens.push(tokenName);

      return {
        rows: [
          {
            id: "minted-1",
            name: tokenName,
            scopes: ["admin"],
            created_at: FIXED_TIMESTAMP.toISOString(),
          },
        ],
      };
    }

    return { rows: [] };
  });

  return { pool, insertedTokens };
}

function clientRefusalOutcome(statusCode: number): string {
  if (statusCode === 400 || statusCode === 403) {
    return "refused";
  }

  return `unexpected-status:${statusCode}`;
}

function knownSessionRows<T>(sessionScopes: string[] | null, rows: T[]): T[] {
  return sessionScopes === null ? [] : rows;
}
