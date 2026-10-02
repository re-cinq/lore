import { describe, it, expect, vi } from "vitest";
import type { Octokit } from "octokit";
import {
  verifyApproval,
  parsePrRef,
  isCodeowner,
  TwoKeyError,
} from "./dark-factory-authz.js";

const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64");

function fakeOctokit(init: {
  prState?: string;
  prLabels?: string[];
  pullsGetError?: unknown;
  events?: unknown[];
  listEventsError?: unknown;
  codeownersContent?: string | null;
}) {
  return {
    rest: {
      pulls: {
        get: mockPullsGet(init.prState, init.pullsGetError, init.prLabels),
      },
      issues: { listEvents: mockListEvents(init.events, init.listEventsError) },
      repos: { getContent: mockGetContent(init.codeownersContent) },
    },
  } as unknown as Octokit;
}

function mockPullsGet(
  prState: string | undefined,
  error: unknown,
  labels: string[] = ["dark-factory-approval"],
) {
  if (error) {
    return vi.fn().mockRejectedValue(error);
  }

  return vi.fn().mockResolvedValue({
    data: {
      state: prState ?? "open",
      html_url: "https://gh/o/r/5",
      labels: labels.map((name) => ({ name })),
    },
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

const labeledEvent = (login: string) => ({
  event: "labeled",
  actor: { login },
  label: { name: "dark-factory-approval" },
});

const unlabeledEvent = (login: string) => ({
  event: "unlabeled",
  actor: { login },
  label: { name: "dark-factory-approval" },
});

const run = (octokit: Octokit) =>
  verifyApproval({ octokit, prRef: "o/r#5", targetRepo: "o/r" });

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

describe("verifyApproval revocation and CLAUDE.md ownership", () => {
  it("refuses an approval whose label was removed after it was applied", async () => {
    const octokit = fakeOctokit({
      prLabels: [],
      events: [labeledEvent("alice"), unlabeledEvent("alice")],
      codeownersContent: "* @alice\n",
    });

    await expect(run(octokit)).rejects.toMatchObject({
      code: "label_missing",
    });
  });

  it("refuses when the events log still shows a labeling but the PR no longer carries the label", async () => {
    const octokit = fakeOctokit({
      prLabels: ["bug"],
      events: [labeledEvent("alice")],
      codeownersContent: "* @alice\n",
    });

    await expect(run(octokit)).rejects.toMatchObject({
      code: "label_missing",
    });
  });

  it("attributes the approval to the owner who relabeled after a non-owner's label was removed", async () => {
    const octokit = fakeOctokit({
      events: [
        labeledEvent("mallory"),
        unlabeledEvent("mallory"),
        labeledEvent("alice"),
      ],
      codeownersContent: "* @alice\n",
    });

    await expect(run(octokit)).resolves.toMatchObject({ approver: "alice" });
  });

  it("refuses a labeler who owns another path but not CLAUDE.md", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("writer")],
      codeownersContent: "* @alice\ndocs/** @writer\n",
    });

    await expect(run(octokit)).rejects.toMatchObject({
      code: "approver_not_codeowner",
    });
  });

  it("accepts the CLAUDE.md owner with the label present", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("alice")],
      codeownersContent: "* @bob\n/CLAUDE.md @alice\n",
    });

    await expect(run(octokit)).resolves.toMatchObject({ approver: "alice" });
  });

  it("lets the last matching rule win over an earlier broader one", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("bob")],
      codeownersContent: "* @bob\nCLAUDE.md @alice\n",
    });

    await expect(run(octokit)).rejects.toMatchObject({
      code: "approver_not_codeowner",
    });
  });

  it("lets a later broad rule override an earlier CLAUDE.md rule", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("alice")],
      codeownersContent: "CLAUDE.md @alice\n* @bob\n",
    });

    await expect(run(octokit)).rejects.toMatchObject({
      code: "approver_not_codeowner",
    });
  });

  it("treats a later rule with no owners as unowning CLAUDE.md", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("alice")],
      codeownersContent: "* @alice\nCLAUDE.md\n",
    });

    await expect(run(octokit)).rejects.toMatchObject({
      code: "approver_not_codeowner",
    });
  });

  it("does not match CLAUDE.md against a rule for another file or a directory", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("alice")],
      codeownersContent:
        "* @alice\n*.ts @bob\n/docs/ @bob\n/src/CLAUDE.md @bob\n",
    });

    await expect(run(octokit)).resolves.toMatchObject({ approver: "alice" });
  });

  it("refuses with team_membership_unresolved when only a team owns CLAUDE.md", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("alice")],
      codeownersContent: "* @alice\nCLAUDE.md @org/leads\n",
    });

    await expect(run(octokit)).rejects.toMatchObject({
      code: "team_membership_unresolved",
    });
  });

  it("matches handles case-insensitively", async () => {
    const octokit = fakeOctokit({
      events: [labeledEvent("Alice")],
      codeownersContent: "CLAUDE.md @alice\n",
    });

    await expect(run(octokit)).resolves.toMatchObject({ approver: "Alice" });
  });

  it("reads past the first page of events", async () => {
    const filler = Array.from({ length: 100 }, () => ({ event: "commented" }));
    const octokit = fakeOctokit({ codeownersContent: "* @alice\n" });

    vi.mocked(octokit.rest.issues.listEvents)
      .mockResolvedValueOnce({ data: filler } as never)
      .mockResolvedValueOnce({ data: [labeledEvent("alice")] } as never);

    await expect(run(octokit)).resolves.toMatchObject({ approver: "alice" });
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
