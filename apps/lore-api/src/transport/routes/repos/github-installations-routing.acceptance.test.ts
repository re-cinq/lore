import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryGithubInstallations } from "@re-cinq/lore-shared/project/github-installations/github-installations-memory.js";
import {
  AUTH,
  LEGACY_TOKEN,
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const ENV_SNAPSHOT = vi.hoisted(() => ({ ...process.env }));

vi.hoisted(async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  process.env.LORE_INGEST_TOKEN = "test-ingest-token";
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  process.env.GITHUB_APP_INSTALLATION_ID = "99999999";
});

import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { buildServer } from "../../../app/build-server.js";

const INSTALLED_AT = new Date("2026-09-10T20:00:00.000Z");

describe("lore-api GitHub App installation resolution", () => {
  useRateLimitSafeClock();

  afterEach(() => {
    setPool(null as never);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env = { ...ENV_SNAPSHOT };
  });

  it("reads PR status through each repository owner's recorded installation and falls back to GITHUB_APP_INSTALLATION_ID when absent", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    const installations = await seedInstallations();
    const pool = installationsPool(installations, [
      "Acme-Corp/service",
      "re-cinq/lore",
      "fallback-org/tool",
    ]);

    setPool(pool as never);
    const { prAuthTokens } = stubPrGitHubFetch();
    const server = buildServer(() => pool as never);

    const acme = await server.inject({
      method: "GET",
      url: "/api/pr-status?repo=Acme-Corp/service&pr_number=5",
      headers: AUTH,
    });
    const recinq = await server.inject({
      method: "GET",
      url: "/api/pr-status?repo=re-cinq/lore&pr_number=5",
      headers: AUTH,
    });
    const fallback = await server.inject({
      method: "GET",
      url: "/api/pr-status?repo=fallback-org/tool&pr_number=5",
      headers: AUTH,
    });

    expect({
      statuses: [acme.statusCode, recinq.statusCode, fallback.statusCode],
      prAuthTokens,
    }).toEqual({
      statuses: [200, 200, 200],
      prAuthTokens: {
        "Acme-Corp/service": "ghs_inst_81111111",
        "re-cinq/lore": "ghs_inst_82222222",
        "fallback-org/tool": "ghs_inst_99999999",
      },
    });
  });

  it("aggregates available repositories across all recorded installations and falls back to GITHUB_APP_INSTALLATION_ID when none are recorded", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    const installations = await seedInstallations();
    const populatedPool = installationsPool(installations, [
      "re-cinq/onboarded",
    ]);
    const emptyPool = installationsPool(
      new InMemoryGithubInstallations(() => INSTALLED_AT),
      [],
    );

    stubInstallationReposFetch();

    const multiRes = await buildServer(() => populatedPool as never).inject({
      method: "GET",
      url: "/api/repos/available",
      headers: AUTH,
    });
    const fallbackRes = await buildServer(() => emptyPool as never).inject({
      method: "GET",
      url: "/api/repos/available",
      headers: AUTH,
    });

    expect({
      multiStatus: multiRes.statusCode,
      multiRepos: (multiRes.result as Array<{ full_name: string }>).map(
        (repo) => repo.full_name,
      ),
      fallbackRepos: (fallbackRes.result as Array<{ full_name: string }>).map(
        (repo) => repo.full_name,
      ),
    }).toEqual({
      multiStatus: 200,
      multiRepos: ["acme-corp/api", "re-cinq/new-repo"],
      fallbackRepos: ["fallback-org/legacy-repo"],
    });
  });

  it("refuses with 404 without minting an installation token when the repository is not onboarded", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    const installations = await seedInstallations();
    const pool = installationsPool(installations, ["Acme-Corp/service"]);

    setPool(pool as never);
    const { attemptedInstallations, prAuthTokens } = stubPrGitHubFetch();
    const server = buildServer(() => pool as never);

    const refused = await server.inject({
      method: "GET",
      url: "/api/pr-status?repo=Acme-Corp/unregistered&pr_number=5",
      headers: AUTH,
    });

    expect({
      status: refused.statusCode,
      attemptedInstallations,
      prAuthTokens,
    }).toEqual({
      status: 404,
      attemptedInstallations: [],
      prAuthTokens: {},
    });
  });

  it("fails with 500 rather than falling back to GITHUB_APP_INSTALLATION_ID when the owner's recorded installation cannot mint a token", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    const installations = await seedInstallations();

    await installations.upsert({
      installationId: "83333333",
      accountLogin: "broken-org",
      accountType: "Organization",
      repositorySelection: "all",
      suspendedAt: null,
    });
    const pool = installationsPool(installations, ["broken-org/service"]);

    setPool(pool as never);
    const { attemptedInstallations, prAuthTokens } = stubPrGitHubFetch();
    const server = buildServer(() => pool as never);

    const failed = await server.inject({
      method: "GET",
      url: "/api/pr-status?repo=broken-org/service&pr_number=5",
      headers: AUTH,
    });

    expect({
      status: failed.statusCode,
      attemptedInstallations,
      prAuthTokens,
    }).toEqual({
      status: 500,
      attemptedInstallations: ["83333333"],
      prAuthTokens: {},
    });
  });
});

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
        return queryRepos(onboardedRepos, sql, params);
      }

      return { rows: [], rowCount: 0 };
    },
  );

  return pool;
}

async function queryInstallations(
  installations: InMemoryGithubInstallations,
  sql: string,
  params: unknown[],
) {
  if (!sql.includes("lower(account_login) = lower($1)")) {
    const rows = (await installations.list()).map(toInstallationRow);

    return { rows, rowCount: rows.length };
  }

  const found = await installations.findByAccount(String(params[0]));
  const rows = found ? [toInstallationRow(found)] : [];

  return { rows, rowCount: rows.length };
}

function queryRepos(onboardedRepos: string[], sql: string, params: unknown[]) {
  if (!sql.includes("LOWER(full_name) = LOWER($1)")) {
    const rows = onboardedRepos.map(toRepoRow);

    return { rows, rowCount: rows.length };
  }

  const requested = String(params[0] ?? "").toLowerCase();
  const matched = onboardedRepos.find(
    (repo) => repo.toLowerCase() === requested,
  );
  const rows = matched ? [toRepoRow(matched)] : [];

  return { rows, rowCount: rows.length };
}

function toInstallationRow(row: {
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

function toRepoRow(fullName: string) {
  return {
    full_name: fullName,
    team: null,
    settings: {},
    onboarded_at: INSTALLED_AT,
  };
}

function stubPrGitHubFetch() {
  const prAuthTokens: Record<string, string> = {};
  const attemptedInstallations: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const { pathname } = new URL(url);

      const tokenMatch = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(
        pathname,
      );

      if (tokenMatch) {
        attemptedInstallations.push(tokenMatch[1]);

        return mintedTokenResponse(tokenMatch[1]);
      }

      const prMatch = /^\/repos\/([^/]+\/[^/]+)\/pulls\/5$/.exec(pathname);

      if (prMatch) {
        prAuthTokens[prMatch[1]] = bareBearer(authorizationOf(input, init));

        return jsonResponse(200, {
          number: 5,
          title: "Fix thing",
          state: "open",
          draft: false,
          merged: false,
          mergeable: true,
          html_url: `https://github.com/${prMatch[1]}/pull/5`,
          head: { sha: "abc123" },
        });
      }

      return prAuxiliaryResponse(pathname);
    }),
  );

  return { attemptedInstallations, prAuthTokens };
}

function mintedTokenResponse(installationId: string): Response {
  if (installationId === "83333333") {
    return jsonResponse(401, { message: "Suspended" });
  }

  return jsonResponse(201, {
    token: `ghs_inst_${installationId}`,
    expires_at: "2099-01-01T00:00:00Z",
  });
}

function prAuxiliaryResponse(pathname: string): Response {
  if (pathname.endsWith("/reviews")) {
    return jsonResponse(200, []);
  }

  if (pathname.endsWith("/check-runs")) {
    return jsonResponse(200, { check_runs: [] });
  }

  if (pathname === "/graphql") {
    return jsonResponse(200, {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [],
            },
          },
        },
      },
    });
  }

  return jsonResponse(404, { message: `Unhandled ${pathname}` });
}

function stubInstallationReposFetch() {
  const reposByToken: Record<
    string,
    Array<{ full_name: string; owner: { login: string }; name: string }>
  > = {
    ghs_inst_81111111: [
      {
        full_name: "acme-corp/api",
        owner: { login: "acme-corp" },
        name: "api",
      },
    ],
    ghs_inst_82222222: [
      {
        full_name: "re-cinq/onboarded",
        owner: { login: "re-cinq" },
        name: "onboarded",
      },
      {
        full_name: "re-cinq/new-repo",
        owner: { login: "re-cinq" },
        name: "new-repo",
      },
    ],
    ghs_inst_99999999: [
      {
        full_name: "fallback-org/legacy-repo",
        owner: { login: "fallback-org" },
        name: "legacy-repo",
      },
    ],
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const { pathname } = new URL(url);

      const tokenMatch = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(
        pathname,
      );

      if (tokenMatch) {
        return jsonResponse(201, {
          token: `ghs_inst_${tokenMatch[1]}`,
          expires_at: "2099-01-01T00:00:00Z",
        });
      }

      if (pathname === "/installation/repositories") {
        const token = bareBearer(authorizationOf(input, init));

        return jsonResponse(200, {
          repositories: reposByToken[token] ?? [],
        });
      }

      return jsonResponse(404, { message: `Unhandled ${pathname}` });
    }),
  );
}

function authorizationOf(
  input: string | URL | Request,
  init?: RequestInit,
): string {
  const headers =
    init?.headers ?? (input instanceof Request ? input.headers : undefined);

  return headers ? (new Headers(headers).get("authorization") ?? "") : "";
}

function bareBearer(header: string): string {
  return header.replace(/^(Bearer|token)\s+/i, "");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
