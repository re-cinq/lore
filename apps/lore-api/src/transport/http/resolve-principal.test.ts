import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { resolvePrincipal } from "./auth.js";

const originalEnv = { ...process.env };
const ALL_SCOPES = ["read", "write", "task", "webhook", "admin"];
const sha256 = (token: string) =>
  createHash("sha256").update(token).digest("hex");

describe("resolvePrincipal", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = "legacy-full-access";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("resolves the legacy ingest token to every scope and no person", async () => {
    expect(
      await resolvePrincipal(makePool() as never, "legacy-full-access"),
    ).toEqual({ scopes: ALL_SCOPES, user: null, tokenHash: null });
  });

  it("resolves a user token to its scopes, the person and its hash", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [
        {
          scopes: ["read", "write"],
          kind: "user",
          login: "gedaiu",
          displayName: "Bogdan",
          avatarUrl: "https://a/1",
          repos: ["re-cinq/lore"],
          startedAt: new Date("2026-10-28T10:00:00Z"),
          expiresAt: new Date("2026-10-28T18:00:00Z"),
        },
      ],
    });

    expect(await resolvePrincipal(pool as never, "user-token")).toEqual({
      scopes: ["read", "write"],
      user: {
        login: "gedaiu",
        name: "Bogdan",
        avatarUrl: "https://a/1",
        repos: ["re-cinq/lore"],
        startedAt: "2026-10-28T10:00:00.000Z",
        expiresAt: "2026-10-28T18:00:00.000Z",
      },
      tokenHash: sha256("user-token"),
    });
  });

  it("resolves a service token to its scopes and no person", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ scopes: ["read"], kind: "service", login: null, repos: [] }],
    });

    expect(await resolvePrincipal(pool as never, "ci-token")).toEqual({
      scopes: ["read"],
      user: null,
      tokenHash: sha256("ci-token"),
    });
  });

  it("resolves no principal for a token that matches no active row", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });

    expect(await resolvePrincipal(pool as never, "revoked")).toBeNull();
  });

  it("gives a verified CI identity token write scope only, with no user and no token hash, and carries its repository, ref and default branch", async () => {
    vi.resetModules();
    vi.doMock("./ci-identity-token.js", () => ({
      verifyIdentityToken: async (_pool: unknown, token: string) =>
        token === "aaa.bbb.ccc"
          ? {
              iss: "https://token.actions.githubusercontent.com",
              repository: "acme/app",
              repository_id: "1001",
              repository_owner_id: "2001",
              ref: "refs/heads/feature/x",
            }
          : null,
    }));

    try {
      const { resolvePrincipal: resolve } = await import("./auth.js");
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ default_branch: "main" }] });

      expect(await resolve(pool as never, "aaa.bbb.ccc")).toEqual({
        scopes: ["write"],
        user: null,
        tokenHash: null,
        ciIdentity: {
          repository: "acme/app",
          ref: "refs/heads/feature/x",
          defaultBranch: "main",
        },
      });
      expect(pool.query).not.toHaveBeenCalledWith(expect.any(String), [
        sha256("aaa.bbb.ccc"),
      ]);
    } finally {
      vi.doUnmock("./ci-identity-token.js");
    }
  });

  it("falls through to the stored token lookup when a JWT-shaped bearer does not verify", async () => {
    vi.resetModules();
    vi.doMock("./ci-identity-token.js", () => ({
      verifyIdentityToken: async () => null,
    }));

    try {
      const { resolvePrincipal: resolve } = await import("./auth.js");
      const pool = makePool();

      pool.query.mockResolvedValue({
        rows: [{ scopes: ["read"], kind: "service", login: null, repos: [] }],
      });

      expect(await resolve(pool as never, "bad.jwt.ccc")).toEqual({
        scopes: ["read"],
        user: null,
        tokenHash: sha256("bad.jwt.ccc"),
      });
    } finally {
      vi.doUnmock("./ci-identity-token.js");
    }
  });

  it("takes the default branch to be main when the repository row records none", async () => {
    vi.resetModules();
    vi.doMock("./ci-identity-token.js", () => ({
      verifyIdentityToken: async (_pool: unknown, token: string) =>
        token === "aaa.bbb.ccc"
          ? {
              repository: "acme/app",
              repository_id: "1001",
              repository_owner_id: "2001",
              ref: "refs/heads/main",
            }
          : null,
    }));

    try {
      const { resolvePrincipal: resolve } = await import("./auth.js");
      const noRow = { rows: [] };
      const nullBranch = { rows: [{ default_branch: null }] };
      const pool = makePool();
      const defaults: unknown[] = [];

      for (const answer of [noRow, nullBranch]) {
        pool.query.mockResolvedValue(answer);
        const principal = await resolve(pool as never, "aaa.bbb.ccc");

        defaults.push(principal?.ciIdentity?.defaultBranch);
      }

      expect(defaults).toEqual(["main", "main"]);
    } finally {
      vi.doUnmock("./ci-identity-token.js");
    }
  });
});
