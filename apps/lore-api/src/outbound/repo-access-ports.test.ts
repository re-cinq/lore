import { describe, it, expect, vi, beforeEach } from "vitest";

const getCollaboratorPermissionLevel = vi.fn();

vi.mock("@re-cinq/lore-shared/project/lib/platform-github-auth.js", () => ({
  buildOctokit: vi.fn(async () => ({
    rest: { repos: { getCollaboratorPermissionLevel } },
  })),
}));

const { repoAccessPorts } = await import("./repo-access-ports.js");

const query = vi.fn(async (_sql: string, _values: unknown[]) => ({
  rows: [],
}));
const ports = repoAccessPorts(() => ({ query }) as never, {});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("repo access ports", () => {
  it.each(["admin", "write", "read", "none"] as const)(
    "reads GitHub's %s for the person on the repo, asked by owner, name and login",
    async (permission) => {
      getCollaboratorPermissionLevel.mockResolvedValue({
        data: { permission },
      });

      expect({
        answer: await ports.permissionOf("ana", "acme/app"),
        asked: getCollaboratorPermissionLevel.mock.calls[0][0],
      }).toEqual({
        answer: permission,
        asked: { owner: "acme", repo: "app", username: "ana" },
      });
    },
  );

  it("reads a repo or person GitHub does not know as none", async () => {
    getCollaboratorPermissionLevel.mockRejectedValue({ status: 404 });

    expect(await ports.permissionOf("ana", "other/gone")).toBe("none");
  });

  it("reads an answer that is none of GitHub's four roles as none", async () => {
    getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: "owner-ish" },
    });

    expect(await ports.permissionOf("ana", "acme/app")).toBe("none");
  });

  it("refuses a repository name that climbs out of owner/name without asking GitHub for its prefix", async () => {
    expect({
      climbing: await ports.permissionOf("ana", "acme/app/../../other/secret"),
      asked: getCollaboratorPermissionLevel.mock.calls,
    }).toEqual({ climbing: "none", asked: [] });
  });

  it.each([
    "acme",
    "acme/app/extra",
    "/app",
    "acme/",
    "acme/app?x=1",
    "ac me/app",
    "acme/a%2Fb",
  ])(
    "reads the malformed repository name %s as none without asking GitHub",
    async (repo) => {
      expect({
        answer: await ports.permissionOf("ana", repo),
        asked: getCollaboratorPermissionLevel.mock.calls,
      }).toEqual({ answer: "none", asked: [] });
    },
  );

  it("passes on a failure that is not a 404, so the caller can refuse", async () => {
    getCollaboratorPermissionLevel.mockRejectedValue({ status: 500 });

    await expect(ports.permissionOf("ana", "acme/app")).rejects.toEqual({
      status: 500,
    });
  });

  it("adds the repo to the person's session row, and only to a person's", async () => {
    await ports.remember("ana-hash", "acme/new-repo");

    expect({
      sql: String(query.mock.calls[0][0]).replace(/\s+/g, " "),
      values: query.mock.calls[0][1],
    }).toEqual({
      sql: expect.stringContaining(
        "UPDATE pipeline.api_tokens SET repos = array_append(repos, $2) WHERE token_hash = $1 AND kind = 'user'",
      ),
      values: ["ana-hash", "acme/new-repo"],
    });
  });

  it("reads a repository whose owner or name is a dot segment as none without asking GitHub", async () => {
    expect({
      ownerDot: await ports.permissionOf("ana", "./app"),
      ownerDots: await ports.permissionOf("ana", "../app"),
      nameDot: await ports.permissionOf("ana", "acme/."),
      nameDots: await ports.permissionOf("ana", "acme/.."),
      asked: getCollaboratorPermissionLevel.mock.calls,
    }).toEqual({
      ownerDot: "none",
      ownerDots: "none",
      nameDot: "none",
      nameDots: "none",
      asked: [],
    });
  });

  it("asks as the App, never reading the person's token, when no Step 3 encryption key is configured", async () => {
    getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: "write" },
    });
    const appEnv = { GITHUB_APP_ID: "999" };
    const personEnv = vi.fn(async () => ({ GITHUB_TOKEN: "ghu_ana" }));
    const withoutKey = repoAccessPorts(
      () => ({ query }) as never,
      appEnv,
      personEnv,
    );
    const { buildOctokit } =
      await import("@re-cinq/lore-shared/project/lib/platform-github-auth.js");

    expect({
      answer: await withoutKey.permissionOf("ana", "acme/app", "ana-hash"),
      personEnvCalls: personEnv.mock.calls,
      octokitEnvs: vi.mocked(buildOctokit).mock.calls,
    }).toEqual({
      answer: "write",
      personEnvCalls: [],
      octokitEnvs: [[appEnv]],
    });
  });

  it("asks with the person's Step 3 env when available and falls back to the App env without a pool, token hash, or stored token", async () => {
    getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: "write" },
    });
    const pool = { query } as never;
    const appEnv = { LORE_USER_TOKEN_ENCRYPTION_KEY: "k" };
    const anaEnv = { GITHUB_TOKEN: "ghu_ana" };
    const personEnv = vi.fn(async (_db: unknown, hash: string) =>
      hash === "ana-hash" ? anaEnv : undefined,
    );
    const keyed = repoAccessPorts(() => pool, appEnv, personEnv);
    const poolless = repoAccessPorts(() => null, appEnv, personEnv);
    const { buildOctokit } =
      await import("@re-cinq/lore-shared/project/lib/platform-github-auth.js");

    expect({
      withToken: await keyed.permissionOf("ana", "acme/app", "ana-hash"),
      withoutPool: await poolless.permissionOf("ana", "acme/app", "ana-hash"),
      withoutHash: await keyed.permissionOf("ana", "acme/app"),
      withoutStoredToken: await keyed.permissionOf(
        "ana",
        "acme/app",
        "legacy-hash",
      ),
      personEnvCalls: personEnv.mock.calls,
      octokitEnvs: vi.mocked(buildOctokit).mock.calls,
    }).toEqual({
      withToken: "write",
      withoutPool: "write",
      withoutHash: "write",
      withoutStoredToken: "write",
      personEnvCalls: [
        [pool, "ana-hash"],
        [pool, "legacy-hash"],
      ],
      octokitEnvs: [[anaEnv], [appEnv], [appEnv], [appEnv]],
    });
  });

  it("rejects with PersonTokenUnavailable, asking GitHub nothing, when the person's token cannot be read", async () => {
    const keyed = repoAccessPorts(
      () => ({ query }) as never,
      { LORE_USER_TOKEN_ENCRYPTION_KEY: "k" },
      async () => {
        throw new Error("refresh refused");
      },
    );
    const { PersonTokenUnavailable } = await import("./repo-access-ports.js");
    const { buildOctokit } =
      await import("@re-cinq/lore-shared/project/lib/platform-github-auth.js");

    await expect(
      keyed.permissionOf("ana", "acme/app", "ana-hash"),
    ).rejects.toEqual(new PersonTokenUnavailable("refresh refused"));
    expect({
      octokitCalls: vi.mocked(buildOctokit).mock.calls,
      asked: getCollaboratorPermissionLevel.mock.calls,
    }).toEqual({ octokitCalls: [], asked: [] });
  });
});
