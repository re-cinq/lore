import { describe, it, expect, vi, beforeEach } from "vitest";

const getCollaboratorPermissionLevel = vi.fn();

vi.mock("@re-cinq/lore-shared/project/lib/platform-github-auth.js", () => ({
  buildOctokit: async () => ({
    rest: { repos: { getCollaboratorPermissionLevel } },
  }),
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
});
