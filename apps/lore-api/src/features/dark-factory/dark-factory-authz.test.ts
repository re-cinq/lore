import { describe, it, expect, vi } from "vitest";
import type { Octokit } from "octokit";
import {
  verifyApproval,
  parsePrRef,
  isCodeowner,
  TwoKeyError,
} from "./dark-factory-authz.js";

const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64");

function mockPullsGet(prState: string | undefined, error: unknown) {
  if (error) {
    return vi.fn().mockRejectedValue(error);
  }

  return vi.fn().mockResolvedValue({
    data: { state: prState ?? "open", html_url: "https://gh/o/r/5" },
  });
}

function mockListEvents(events: unknown[] | undefined, error: unknown) {
  if (error) {
    return vi.fn().mockRejectedValue(error);
  }

  return vi.fn().mockResolvedValue({ data: events ?? [] });
}

function mockGetContent(codeownersContent: string | null | undefined) {
  if (codeownersContent === null || codeownersContent === undefined) {
    return vi.fn().mockRejectedValue({ status: 404 });
  }

  return vi.fn().mockResolvedValue({
    data: { content: b64(codeownersContent), encoding: "base64" },
  });
}

function fakeOctokit(init: {
  prState?: string;
  pullsGetError?: unknown;
  events?: unknown[];
  listEventsError?: unknown;
  codeownersContent?: string | null;
}) {
  return {
    rest: {
      pulls: { get: mockPullsGet(init.prState, init.pullsGetError) },
      issues: { listEvents: mockListEvents(init.events, init.listEventsError) },
      repos: { getContent: mockGetContent(init.codeownersContent) },
    },
  } as unknown as Octokit;
}

const labeledEvent = (login: string) => ({
  event: "labeled",
  actor: { login },
  label: { name: "dark-factory-approval" },
});

describe("parsePrRef", () => {
  it("parses owner/repo#N", () => {
    expect(parsePrRef("o/r#42")).toEqual({ owner: "o", repo: "r", number: 42 });
  });

  it("throws invalid_pr_ref on a malformed reference", () => {
    expect(() => parsePrRef("not-a-ref")).toThrow(
      new TwoKeyError(
        'Invalid PR reference "not-a-ref" — expected owner/repo#N',
        "invalid_pr_ref",
      ),
    );
  });
});

describe("verifyApproval", () => {
  it("throws wrong_repo when the PR ref targets a different repo", async () => {
    const octokit = fakeOctokit({});

    await expect(
      verifyApproval({ octokit, prRef: "other/repo#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError(
        "Approval PR other/repo#5 is against other/repo, not o/r",
        "wrong_repo",
      ),
    );
  });

  it("throws pr_not_found on a 404 from pulls.get", async () => {
    const octokit = fakeOctokit({ pullsGetError: { status: 404 } });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError("Approval PR o/r#5 not found", "pr_not_found"),
    );
  });

  it("throws github_api on a non-404 pulls.get failure", async () => {
    const octokit = fakeOctokit({
      pullsGetError: new Error("rate limited"),
    });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError(
        "GitHub API error fetching o/r#5: rate limited",
        "github_api",
      ),
    );
  });

  it("throws pr_state when the approval PR is not open", async () => {
    const octokit = fakeOctokit({ prState: "closed" });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError(
        "Approval PR o/r#5 is closed; ceremony requires open PR",
        "pr_state",
      ),
    );
  });

  it("throws github_api on a listEvents failure", async () => {
    const octokit = fakeOctokit({
      listEventsError: new Error("timeout"),
    });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError(
        "GitHub API error fetching events: timeout",
        "github_api",
      ),
    );
  });

  it("throws label_missing when no labeled event carries the approval label", async () => {
    const octokit = fakeOctokit({
      events: [{ event: "commented" }, { event: "closed" }],
    });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError(
        'Approval label "dark-factory-approval" missing on PR o/r#5',
        "label_missing",
      ),
    );
  });

  it("throws label_missing when the labeled event carries no actor login", async () => {
    const octokit = fakeOctokit({
      events: [{ event: "labeled", label: { name: "dark-factory-approval" } }],
    });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError(
        'Approval label "dark-factory-approval" missing on PR o/r#5',
        "label_missing",
      ),
    );
  });

  it("resolves with evidence when the approver is a direct CODEOWNERS handle", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("alice")],
      codeownersContent: "* @alice @bob\n",
    });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).resolves.toEqual({
      prRef: "o/r#5",
      approver: "alice",
      prUrl: "https://gh/o/r/5",
    });
  });

  it("throws approver_not_codeowner when CODEOWNERS mixes user and team handles", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("carol")],
      codeownersContent: "* @alice @org/reviewers\n",
    });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError(
        "carol is not a CODEOWNERS member of o/r",
        "approver_not_codeowner",
      ),
    );
  });

  it("throws approver_not_codeowner when CODEOWNERS is empty", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("carol")],
      codeownersContent: null,
    });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(
      new TwoKeyError(
        "carol is not a CODEOWNERS member of o/r",
        "approver_not_codeowner",
      ),
    );
  });

  it("throws team_membership_unresolved when CODEOWNERS lists only team handles", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("carol")],
      codeownersContent: "* @org/reviewers @org/leads\n",
    });

    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toThrow(TwoKeyError);
    await expect(
      verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" }),
    ).rejects.toMatchObject({ code: "team_membership_unresolved" });
  });
});

describe("isCodeowner", () => {
  it("matches a login against a bare or @-prefixed handle", () => {
    const rows = [{ pattern: "*", owners: ["@alice"] }];

    expect(isCodeowner("alice", rows)).toBe(true);
    expect(isCodeowner("@alice", rows)).toBe(true);
    expect(isCodeowner("bob", rows)).toBe(false);
  });
});
