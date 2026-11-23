import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryGithubInstallations } from "../github-installations/github-installations-memory.js";
import type { DgraphClientPort, PgPool } from "../../memory-store.js";
import { createProject } from "./project-factory.js";
import { PlatformGitHub } from "./platform-github.js";
import type { GithubInstallationsRepository } from "../github-installations/github-installations-port.js";

const INSTALLED_AT = new Date("2026-09-10T20:00:00.000Z");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

const NO_DGRAPH = {} as DgraphClientPort;

describe("PlatformGitHub per-owner installation resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves each repo owner's App installation case-insensitively and falls back to GITHUB_APP_INSTALLATION_ID when absent", async () => {
    const installations = await seedInstallations();
    const pool = installationsPool(installations);
    const env: NodeJS.ProcessEnv = {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
      GITHUB_APP_INSTALLATION_ID: "99999999",
    };

    const acme = await createProject("Acme-Corp/service", pool, NO_DGRAPH, {
      env,
    });
    const recinq = await createProject("re-cinq/lore", pool, NO_DGRAPH, {
      env,
    });
    const fallback = await createProject("fallback-org/tool", pool, NO_DGRAPH, {
      env,
    });

    const recorded = stubGitHubFetch();

    await exerciseProjectOperations(acme, recinq, fallback);

    const direct = new PlatformGitHub(env, installations);

    await exerciseDirectPullMutations(direct);
    expect(recorded).toEqual({
      mintedInstallations: [
        "81111111",
        "82222222",
        "99999999",
        "81111111",
        "82222222",
      ],
      issueHeaders: {
        "Acme-Corp/service": "token ghs_inst_81111111",
        "re-cinq/lore": "token ghs_inst_82222222",
        "fallback-org/tool": "token ghs_inst_99999999",
      },
      graphqlHeaders: {
        PR_acme: "token ghs_inst_81111111",
        PR_recinq: "token ghs_inst_82222222",
        PRRT_acme: "token ghs_inst_81111111",
        PRRT_fallback: "token ghs_inst_99999999",
        PR_direct_acme: "token ghs_inst_81111111",
        PR_direct_recinq: "token ghs_inst_82222222",
        PRRT_direct_acme: "token ghs_inst_81111111",
      },
    });
  });

  it("refuses rather than falling back to GITHUB_APP_INSTALLATION_ID when the installations registry errors", async () => {
    const env = appEnv();
    const broken: GithubInstallationsRepository = {
      upsert: () => Promise.reject(new Error("db down")),
      findByAccount: () => Promise.reject(new Error("db down")),
      remove: () => Promise.reject(new Error("db down")),
      list: () => Promise.reject(new Error("db down")),
    };
    const github = new PlatformGitHub(env, broken);
    const { mintedInstallations, issueHeaders } = stubGitHubFetch();

    await expect(github.listIssues("acme-corp/service")).rejects.toThrow(
      "db down",
    );
    await expect(
      github.getInstallationToken("acme-corp/service"),
    ).rejects.toThrow("db down");
    expect({ mintedInstallations, issueHeaders }).toEqual({
      mintedInstallations: [],
      issueHeaders: {},
    });
  });

  it("refuses rather than falling back to GITHUB_APP_INSTALLATION_ID when the owner's recorded installation cannot mint a token", async () => {
    const installations = await seedInstallations();
    const github = new PlatformGitHub(appEnv(), installations);
    const { mintedInstallations, issueHeaders } = stubGitHubFetch({
      refuseMintFor: "81111111",
    });

    await expect(
      github.getInstallationToken("Acme-Corp/service"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(github.listIssues("Acme-Corp/service")).rejects.toMatchObject({
      status: 404,
    });
    expect({
      fellBackToEnv: mintedInstallations.includes("99999999"),
      issueHeaders,
    }).toEqual({ fellBackToEnv: false, issueHeaders: {} });
  });

  it("reports configured with an installations registry and no GITHUB_APP_INSTALLATION_ID, and unconfigured with neither", async () => {
    const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } = appEnv();
    const appCredentials = { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY };
    const installations = await seedInstallations();

    expect({
      withRegistry: new PlatformGitHub(
        appCredentials,
        installations,
      ).isConfigured(),
      withoutRegistry: new PlatformGitHub(appCredentials).isConfigured(),
      registryWithoutApp: new PlatformGitHub({}, installations).isConfigured(),
    }).toEqual({
      withRegistry: true,
      withoutRegistry: false,
      registryWithoutApp: false,
    });
  });
});

function appEnv(): NodeJS.ProcessEnv {
  return {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
    GITHUB_APP_INSTALLATION_ID: "99999999",
  };
}

async function exerciseProjectOperations(
  acme: Awaited<ReturnType<typeof createProject>>,
  recinq: Awaited<ReturnType<typeof createProject>>,
  fallback: Awaited<ReturnType<typeof createProject>>,
): Promise<void> {
  await acme.issues.list();
  await recinq.issues.list();
  await fallback.issues.list();
  await acme.pulls.enableAutoMerge("PR_acme", "squash");
  await recinq.pulls.cancelAutoMerge("PR_recinq");
  await acme.pulls.resolveReviewThread("PRRT_acme");
  await fallback.pulls.resolveReviewThread("PRRT_fallback");
}

async function exerciseDirectPullMutations(
  direct: PlatformGitHub,
): Promise<void> {
  await direct.enablePullRequestAutoMerge(
    "PR_direct_acme",
    "squash",
    "Acme-Corp/service",
  );
  await direct.disablePullRequestAutoMerge("PR_direct_recinq", "re-cinq/lore");
  await direct.resolveReviewThread("PRRT_direct_acme", "Acme-Corp/service");
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

function installationsPool(installations: InMemoryGithubInstallations): PgPool {
  return {
    query: async <T>(
      text: string,
      params: unknown[] = [],
    ): Promise<{ rows: T[] }> => {
      if (!text.includes("lore.github_installations")) {
        return { rows: [] };
      }

      if (text.includes("lower(account_login) = lower($1)")) {
        const found = await installations.findByAccount(String(params[0]));

        return { rows: (found ? [toRow(found)] : []) as T[] };
      }

      const all = await installations.list();

      return { rows: all.map(toRow) as T[] };
    },
  };
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

function stubGitHubFetch(opts: { refuseMintFor?: string } = {}) {
  const mintedInstallations: string[] = [];
  const issueHeaders: Record<string, string> = {};
  const graphqlHeaders: Record<string, string> = {};

  const mint = (installationId: string): Response => {
    mintedInstallations.push(installationId);

    return installationId === opts.refuseMintFor
      ? jsonResponse(404, { message: "Not Found" })
      : jsonResponse(201, {
          token: `ghs_inst_${installationId}`,
          expires_at: "2099-01-01T00:00:00Z",
        });
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const { pathname } = new URL(
        typeof input === "string" ? input : input.toString(),
      );
      const tokenMatch = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(
        pathname,
      );

      if (tokenMatch) {
        return mint(tokenMatch[1]);
      }

      if (pathname === "/graphql") {
        return recordGraphql(graphqlHeaders, input, init);
      }

      const issuesMatch = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(pathname);

      if (!issuesMatch) {
        return jsonResponse(404, { message: `Unhandled ${pathname}` });
      }
      issueHeaders[issuesMatch[1]] = authorizationOf(input, init);

      return jsonResponse(200, []);
    }),
  );

  return { mintedInstallations, issueHeaders, graphqlHeaders };
}

async function recordGraphql(
  graphqlHeaders: Record<string, string>,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const vars = await requestVariables(input, init);
  const key = vars.pullRequestId ?? vars.threadId ?? "unknown";

  graphqlHeaders[key] = authorizationOf(input, init);

  return jsonResponse(200, { data: {} });
}

async function requestVariables(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<{ pullRequestId?: string; threadId?: string }> {
  const raw = await requestBodyText(input, init);

  return (
    (
      JSON.parse(raw) as {
        variables?: { pullRequestId?: string; threadId?: string };
      }
    ).variables ?? {}
  );
}

async function requestBodyText(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<string> {
  if (typeof init?.body === "string") {
    return init.body;
  }

  if (input instanceof Request) {
    return input.clone().text();
  }

  return "{}";
}

function authorizationOf(
  input: string | URL | Request,
  init?: RequestInit,
): string {
  const headers =
    init?.headers ?? (input instanceof Request ? input.headers : undefined);

  return headers ? (new Headers(headers).get("authorization") ?? "") : "";
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
