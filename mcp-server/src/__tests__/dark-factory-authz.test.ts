import { describe, it, expect, vi } from "vitest";
import {
  parsePrRef,
  isCodeowner,
  verifyApproval,
  TwoKeyError,
  APPROVAL_LABEL,
} from "../dark-factory-authz.js";

// ---------------------------------------------------------------------------
// parsePrRef
// ---------------------------------------------------------------------------

describe("parsePrRef", () => {
  it("parses a valid owner/repo#N ref", () => {
    expect(parsePrRef("acme/myrepo#42")).toEqual({
      owner: "acme",
      repo: "myrepo",
      number: 42,
    });
  });

  it("parses refs with dots and dashes", () => {
    expect(parsePrRef("re-cinq/lore.v2#1")).toEqual({
      owner: "re-cinq",
      repo: "lore.v2",
      number: 1,
    });
  });

  it("throws invalid_pr_ref for bare repo name", () => {
    expect(() => parsePrRef("myrepo#42")).toThrowError(
      expect.objectContaining({ code: "invalid_pr_ref" }),
    );
  });

  it("throws invalid_pr_ref for missing PR number", () => {
    expect(() => parsePrRef("owner/repo")).toThrowError(
      expect.objectContaining({ code: "invalid_pr_ref" }),
    );
  });

  it("throws invalid_pr_ref for empty string", () => {
    expect(() => parsePrRef("")).toThrowError(
      expect.objectContaining({ code: "invalid_pr_ref" }),
    );
  });
});

// ---------------------------------------------------------------------------
// isCodeowner
// ---------------------------------------------------------------------------

describe("isCodeowner", () => {
  const rows = [
    { pattern: "CLAUDE.md", owners: ["@alice", "@bob"] },
    { pattern: "*.ts", owners: ["@org/team-typescript"] },
  ];

  it("matches a direct user handle", () => {
    expect(isCodeowner("alice", rows)).toBe(true);
    expect(isCodeowner("bob", rows)).toBe(true);
  });

  it("matches a login that already has @-prefix", () => {
    expect(isCodeowner("@alice", rows)).toBe(true);
  });

  it("returns false for a login not in any row", () => {
    expect(isCodeowner("carol", rows)).toBe(false);
  });

  it("returns false for an empty codeowners list", () => {
    expect(isCodeowner("alice", [])).toBe(false);
  });

  it("matches a team handle when it appears literally in CODEOWNERS", () => {
    // isCodeowner prepends @ and checks membership; it does not distinguish
    // user handles from team handles — that distinction is handled by
    // verifyApproval's team_membership_unresolved path.
    expect(isCodeowner("org/team-typescript", rows)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyApproval — helpers to build minimal Octokit doubles
// ---------------------------------------------------------------------------

function makeOctokit(overrides: {
  prState?: string;
  prNotFound?: boolean;
  prApiError?: boolean;
  labelEvents?: Array<{ event: string; actor?: { login: string }; label?: { name: string } }>;
  listEventsError?: boolean;
  codeownersContent?: string;
  codeownersNotFound?: boolean;
}) {
  const prState = overrides.prState ?? "open";

  const pullsGet = overrides.prNotFound
    ? vi.fn().mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }))
    : overrides.prApiError
      ? vi.fn().mockRejectedValue(new Error("GitHub API error"))
      : vi.fn().mockResolvedValue({
          data: { state: prState, html_url: "https://github.com/owner/repo/pull/1" },
        });

  const listEvents = overrides.listEventsError
    ? vi.fn().mockRejectedValue(new Error("events API error"))
    : vi.fn().mockResolvedValue({
        data: overrides.labelEvents ?? [
          { event: "labeled", actor: { login: "alice" }, label: { name: APPROVAL_LABEL } },
        ],
      });

  const getContent =
    overrides.codeownersNotFound
      ? vi.fn().mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }))
      : vi.fn().mockImplementation(({ path }: { path: string }) => {
          if (path === ".github/CODEOWNERS") {
            const content = overrides.codeownersContent ?? "CLAUDE.md @alice\n";
            return Promise.resolve({
              data: {
                content: Buffer.from(content).toString("base64"),
                encoding: "base64",
              },
            });
          }
          return Promise.reject(Object.assign(new Error("Not Found"), { status: 404 }));
        });

  return {
    rest: {
      pulls: { get: pullsGet },
      issues: { listEvents },
      repos: { getContent },
    },
  } as any;
}

describe("verifyApproval", () => {
  it("returns evidence on successful ceremony", async () => {
    const octokit = makeOctokit({});
    const evidence = await verifyApproval({
      octokit,
      prRef: "owner/repo#1",
      targetRepo: "owner/repo",
    });
    expect(evidence.prRef).toBe("owner/repo#1");
    expect(evidence.approver).toBe("alice");
    expect(evidence.prUrl).toContain("github.com");
  });

  it("throws wrong_repo when PR is against a different repo", async () => {
    const octokit = makeOctokit({});
    await expect(
      verifyApproval({ octokit, prRef: "owner/other#1", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "wrong_repo" }));
  });

  it("throws pr_not_found on 404", async () => {
    const octokit = makeOctokit({ prNotFound: true });
    await expect(
      verifyApproval({ octokit, prRef: "owner/repo#99", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "pr_not_found" }));
  });

  it("throws github_api on non-404 PR fetch error", async () => {
    const octokit = makeOctokit({ prApiError: true });
    await expect(
      verifyApproval({ octokit, prRef: "owner/repo#1", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "github_api" }));
  });

  it("throws pr_state when PR is not open", async () => {
    const octokit = makeOctokit({ prState: "closed" });
    await expect(
      verifyApproval({ octokit, prRef: "owner/repo#1", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "pr_state" }));
  });

  it("throws label_missing when no labeled event exists", async () => {
    const octokit = makeOctokit({ labelEvents: [] });
    await expect(
      verifyApproval({ octokit, prRef: "owner/repo#1", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "label_missing" }));
  });

  it("throws label_missing when only unrelated labels are present", async () => {
    const octokit = makeOctokit({
      labelEvents: [{ event: "labeled", actor: { login: "alice" }, label: { name: "bug" } }],
    });
    await expect(
      verifyApproval({ octokit, prRef: "owner/repo#1", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "label_missing" }));
  });

  it("throws approver_not_codeowner when labeler is not in CODEOWNERS", async () => {
    const octokit = makeOctokit({
      labelEvents: [
        { event: "labeled", actor: { login: "mallory" }, label: { name: APPROVAL_LABEL } },
      ],
      codeownersContent: "CLAUDE.md @alice\n",
    });
    await expect(
      verifyApproval({ octokit, prRef: "owner/repo#1", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "approver_not_codeowner" }));
  });

  it("throws team_membership_unresolved when CODEOWNERS contains only team handles", async () => {
    const octokit = makeOctokit({
      labelEvents: [
        { event: "labeled", actor: { login: "alice" }, label: { name: APPROVAL_LABEL } },
      ],
      codeownersContent: "CLAUDE.md @org/platform-team\n",
    });
    await expect(
      verifyApproval({ octokit, prRef: "owner/repo#1", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "team_membership_unresolved" }),
    );
  });

  it("throws github_api on listEvents failure", async () => {
    const octokit = makeOctokit({ listEventsError: true });
    await expect(
      verifyApproval({ octokit, prRef: "owner/repo#1", targetRepo: "owner/repo" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "github_api" }));
  });

  it("succeeds even when CODEOWNERS is not in .github/ but is in root", async () => {
    const fallbackGetContent = vi.fn().mockImplementation(({ path }: { path: string }) => {
      if (path === ".github/CODEOWNERS") {
        return Promise.reject(Object.assign(new Error("Not Found"), { status: 404 }));
      }
      if (path === "CODEOWNERS") {
        const content = "CLAUDE.md @alice\n";
        return Promise.resolve({
          data: { content: Buffer.from(content).toString("base64"), encoding: "base64" },
        });
      }
      return Promise.reject(Object.assign(new Error("Not Found"), { status: 404 }));
    });

    const octokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: { state: "open", html_url: "https://github.com/owner/repo/pull/1" },
          }),
        },
        issues: {
          listEvents: vi.fn().mockResolvedValue({
            data: [{ event: "labeled", actor: { login: "alice" }, label: { name: APPROVAL_LABEL } }],
          }),
        },
        repos: { getContent: fallbackGetContent },
      },
    } as any;

    const evidence = await verifyApproval({
      octokit,
      prRef: "owner/repo#1",
      targetRepo: "owner/repo",
    });
    expect(evidence.approver).toBe("alice");
  });

  it("TwoKeyError has correct name and message", () => {
    const err = new TwoKeyError("some message", "label_missing");
    expect(err.name).toBe("TwoKeyError");
    expect(err.message).toBe("some message");
    expect(err.code).toBe("label_missing");
  });
});
