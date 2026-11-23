import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryGithubInstallations } from "@re-cinq/lore-shared/project/github-installations/github-installations-memory.js";
import {
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../../app/build-server.js";

const INSTALLED_AT = new Date("2026-09-10T20:00:00.000Z");
const FLOOR_TOKEN = "floor-shared-token";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const originalEnv = { ...process.env };

describe("POST /api/floor/git-credential per-owner installation", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.FLOOR_GIT_CREDENTIAL_TOKEN = FLOOR_TOKEN;
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = PRIVATE_KEY;
    process.env.GITHUB_APP_INSTALLATION_ID = "99999999";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mints floor git credentials using each owner's recorded installation and falls back to GITHUB_APP_INSTALLATION_ID when absent", async () => {
    const installations = await seedInstallations();
    const pool = installationsPool(installations, [
      "Acme-Corp/service",
      "re-cinq/lore",
      "fallback-org/tool",
    ]);
    const mintedInstallations = stubAccessTokenMinting();
    const server = buildServer(() => pool as never);

    const acme = await requestCredential(
      server,
      "https://github.com/Acme-Corp/service",
    );
    const recinq = await requestCredential(
      server,
      "https://github.com/re-cinq/lore",
    );
    const fallback = await requestCredential(
      server,
      "https://github.com/fallback-org/tool",
    );

    expect({
      statuses: [acme.statusCode, recinq.statusCode, fallback.statusCode],
      passwords: [
        bodyOf(acme).password,
        bodyOf(recinq).password,
        bodyOf(fallback).password,
      ],
      mintedInstallations,
    }).toEqual({
      statuses: [200, 200, 200],
      passwords: [
        "ghs_inst_81111111",
        "ghs_inst_82222222",
        "ghs_inst_99999999",
      ],
      mintedInstallations: ["81111111", "82222222", "99999999"],
    });
  });

  it("refuses with 403 without minting any installation token when the repository is not onboarded", async () => {
    const installations = await seedInstallations();
    const pool = installationsPool(installations, ["Acme-Corp/service"]);
    const mintedInstallations = stubAccessTokenMinting();
    const server = buildServer(() => pool as never);

    const refused = await requestCredential(
      server,
      "https://github.com/Acme-Corp/unregistered",
    );

    expect({
      status: refused.statusCode,
      body: refused.result,
      mintedInstallations,
    }).toEqual({
      status: 403,
      body: { error: "repo-not-onboarded" },
      mintedInstallations: [],
    });
  });

  it("fails rather than falling back to GITHUB_APP_INSTALLATION_ID when the owner's recorded installation cannot mint a token", async () => {
    const installations = await seedInstallations();

    await installations.upsert({
      installationId: "83333333",
      accountLogin: "broken-org",
      accountType: "Organization",
      repositorySelection: "all",
      suspendedAt: null,
    });
    const pool = installationsPool(installations, ["broken-org/service"]);
    const mintedInstallations = stubAccessTokenMinting();
    const server = buildServer(() => pool as never);

    const failed = await requestCredential(
      server,
      "https://github.com/broken-org/service",
    );

    expect({
      status: failed.statusCode,
      mintedInstallations,
    }).toEqual({
      status: 500,
      mintedInstallations: ["83333333"],
    });
  });
});

async function requestCredential(
  server: ReturnType<typeof buildServer>,
  repoUrl: string,
) {
  return server.inject({
    method: "POST",
    url: "/api/floor/git-credential",
    headers: { authorization: `Bearer ${FLOOR_TOKEN}` },
    payload: { repoUrl, access: "write" },
  });
}

function bodyOf(res: { result?: unknown }): { password?: string } {
  return (res.result ?? {}) as { password?: string };
}

async function seedInstallations(): Promise<InMemoryGithubInstallations> {
  const store = new InMemoryGithubInstallations(() => INSTALLED_AT);

  await store.upsert({
    installationId: "81111111",
    accountLogin: "acme-corp",
    accountType: "Organization",
    repositorySelection: "all",
    suspendedAt: null,
  });
  await store.upsert({
    installationId: "82222222",
    accountLogin: "re-cinq",
    accountType: "Organization",
    repositorySelection: "selected",
    suspendedAt: null,
  });

  return store;
}

function installationsPool(
  installations: InMemoryGithubInstallations,
  onboardedRepos: string[],
) {
  const pool = makePool();

  pool.query.mockImplementation(
    async (rawSql: string, params: unknown[] = []) => {
      const sql = String(rawSql);

      if (sql.includes("lore.github_installations")) {
        return queryInstallations(installations, sql, params);
      }

      if (sql.includes("lore.repos")) {
        return queryRepos(onboardedRepos, params);
      }

      return { rows: [], rowCount: 0 };
    },
  );

  return pool;
}

function queryRepos(onboardedRepos: string[], params: unknown[]) {
  const requested = String(params[0] ?? "").toLowerCase();
  const found = onboardedRepos.some((repo) => repo.toLowerCase() === requested);

  return { rows: found ? [{ found: 1 }] : [], rowCount: found ? 1 : 0 };
}

async function queryInstallations(
  installations: InMemoryGithubInstallations,
  sql: string,
  params: unknown[],
) {
  if (sql.includes("lower(account_login) = lower($1)")) {
    const found = await installations.findByAccount(String(params[0]));
    const rows = found ? [toRow(found)] : [];

    return { rows, rowCount: rows.length };
  }

  const rows = (await installations.list()).map(toRow);

  return { rows, rowCount: rows.length };
}

function toRow(row: {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  suspendedAt: Date | null;
  installedAt: Date;
  updatedAt: Date;
}) {
  return {
    installation_id: row.installationId,
    account_login: row.accountLogin,
    account_type: row.accountType,
    repository_selection: row.repositorySelection,
    suspended_at: row.suspendedAt,
    installed_at: row.installedAt,
    updated_at: row.updatedAt,
  };
}

function stubAccessTokenMinting(): string[] {
  const minted: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const { pathname } = new URL(url);
      const match = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(
        pathname,
      );

      if (match) {
        minted.push(match[1]);

        return mintTokenResponse(match[1]);
      }

      return new Response(
        JSON.stringify({ message: `Unhandled ${pathname}` }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }),
  );

  return minted;
}

function mintTokenResponse(installationId: string): Response {
  if (installationId === "83333333") {
    return new Response(JSON.stringify({ message: "Suspended" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      token: `ghs_inst_${installationId}`,
      expires_at: "2099-01-01T00:00:00Z",
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
}
