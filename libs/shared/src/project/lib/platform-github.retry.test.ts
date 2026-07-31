import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlatformGitHub } from "./platform-github.js";

/**
 * The #1017 mutation retry policy: octokit's bundled plugin-retry re-POSTs
 * committed-but-errored requests, duplicating reviews/comments/issues below
 * every application-level dedupe. Every non-idempotent call must pass
 * `request: { retries: 0 }`; reads keep the default retry. The mock records
 * every rest call's params so the sweep asserts the exact request option per
 * endpoint invocation.
 */

const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
const failOnce = new Set<string>();
const responses: Record<string, unknown> = {};

const resetResponses = () => {
  responses["issues.create"] = {
    data: { number: 12, html_url: "https://gh/i/12" },
  };
  responses["git.getRef"] = { data: { object: { sha: "basesha" } } };
  responses["repos.getContent"] = { data: { type: "file", sha: "filesha" } };
  responses["checks.listForRef"] = { data: { check_runs: [] } };
  responses["pulls.create"] = {
    data: {
      number: 9,
      title: "t",
      head: { ref: "feat/x" },
      state: "open",
      html_url: "https://gh/pr/9",
    },
  };
  responses["actions.getRepoPublicKey"] = {
    data: { key: "cHVia2V5", key_id: "1" },
  };
};

const api = (endpoint: string) => async (params: Record<string, unknown>) => {
  calls.push({ endpoint, params });

  if (failOnce.delete(endpoint)) {
    throw { status: 422 };
  }

  return responses[endpoint] ?? {};
};

vi.mock("octokit", () => ({
  Octokit: class {
    rest = {
      issues: {
        create: api("issues.create"),
        createLabel: api("issues.createLabel"),
        createComment: api("issues.createComment"),
        update: api("issues.update"),
        addLabels: api("issues.addLabels"),
        removeLabel: api("issues.removeLabel"),
      },
      pulls: {
        create: api("pulls.create"),
        createReview: api("pulls.createReview"),
        createReplyForReviewComment: api("pulls.createReplyForReviewComment"),
        merge: api("pulls.merge"),
      },
      git: {
        getRef: api("git.getRef"),
        createRef: api("git.createRef"),
        deleteRef: api("git.deleteRef"),
      },
      repos: {
        getContent: api("repos.getContent"),
        createOrUpdateFileContents: api("repos.createOrUpdateFileContents"),
      },
      checks: {
        listForRef: api("checks.listForRef"),
        create: api("checks.create"),
        update: api("checks.update"),
      },
      actions: {
        updateRepoVariable: api("actions.updateRepoVariable"),
        createRepoVariable: api("actions.createRepoVariable"),
        getRepoPublicKey: api("actions.getRepoPublicKey"),
        createOrUpdateRepoSecret: api("actions.createOrUpdateRepoSecret"),
      },
    };
  },
}));

vi.mock("libsodium-wrappers", () => ({
  default: {
    ready: Promise.resolve(),
    base64_variants: { ORIGINAL: 1 },
    from_base64: () => new Uint8Array(32),
    from_string: () => new Uint8Array(4),
    crypto_box_seal: () => new Uint8Array(48),
    to_base64: () => "sealed",
  },
}));

describe("PlatformGitHub mutation retry policy", () => {
  const gh = () => new PlatformGitHub({ GITHUB_TOKEN: "gh-token" });

  beforeEach(() => {
    calls.length = 0;
    failOnce.clear();
    resetResponses();
  });

  it("createReview passes request retries 0 so plugin-retry cannot re-POST a committed review", async () => {
    await gh().createReview("re-cinq/lore", 1016, {
      event: "COMMENT",
      body: "### Lore review",
      comments: [{ path: "a.ts", line: 3, body: "**issue:** dup" }],
    });

    expect(calls).toEqual([
      {
        endpoint: "pulls.createReview",
        params: expect.objectContaining({
          pull_number: 1016,
          request: { retries: 0 },
        }),
      },
    ]);
  });

  it("every mutation endpoint disables plugin-retry with request retries 0 while reads keep the default", async () => {
    const g = gh();
    const repo = "re-cinq/lore";

    await g.createIssue(repo, "t", "b");
    await g.createLabels(repo, [{ name: "lore-managed" }]);
    await g.commentOnIssue(repo, 1, "c");
    await g.comment(repo, 1, "c");
    await g.closeIssue(repo, 1);
    await g.addIssueLabel(repo, 1, "approved");
    await g.addLabel(repo, 1, "approved");
    await g.removeIssueLabel(repo, 1, "approved");
    await g.createBranch(repo, "feat/a");
    failOnce.add("git.createRef");
    await g.createBranch(repo, "feat/a");
    await g.commitFile(repo, "feat/a", "f.md", "x", "m");
    await g.upsertCheckRun(repo, {
      name: "lore",
      headSha: "abc",
      status: "completed",
      title: "t",
      summary: "s",
    });
    responses["checks.listForRef"] = { data: { check_runs: [{ id: 5 }] } };
    await g.upsertCheckRun(repo, {
      name: "lore",
      headSha: "abc",
      status: "completed",
      title: "t",
      summary: "s",
    });
    await g.review(repo, 1, "b", "APPROVE");
    await g.createReview(repo, 1, {
      event: "COMMENT",
      body: "b",
      comments: [],
    });
    await g.replyToReviewComment(repo, 1, 99, "r");
    await g.merge(repo, 1);
    await g.open(repo, "feat/a", "t", "b");
    await g.setRepoVariable(repo, "LORE_VAR", "v");
    failOnce.add("actions.updateRepoVariable");
    await g.setRepoVariable(repo, "LORE_VAR", "v");
    await g.setRepoSecret(repo, "LORE_SECRET", "v");

    const requests: Record<string, unknown[]> = {};

    for (const { endpoint, params } of calls) {
      (requests[endpoint] ??= []).push(params.request);
    }
    const noRetry = { retries: 0 };

    expect(requests).toEqual({
      "issues.create": [noRetry],
      "issues.createLabel": [noRetry],
      "issues.createComment": [noRetry, noRetry],
      "issues.update": [noRetry],
      "issues.addLabels": [noRetry, noRetry, noRetry],
      "issues.removeLabel": [noRetry],
      "git.getRef": [undefined, undefined],
      "git.createRef": [noRetry, noRetry, noRetry],
      "git.deleteRef": [noRetry],
      "repos.getContent": [undefined],
      "repos.createOrUpdateFileContents": [noRetry],
      "checks.listForRef": [undefined, undefined],
      "checks.create": [noRetry],
      "checks.update": [noRetry],
      "pulls.create": [noRetry],
      "pulls.createReview": [noRetry, noRetry],
      "pulls.createReplyForReviewComment": [noRetry],
      "pulls.merge": [noRetry],
      "actions.updateRepoVariable": [noRetry, noRetry],
      "actions.createRepoVariable": [noRetry],
      "actions.getRepoPublicKey": [undefined],
      "actions.createOrUpdateRepoSecret": [noRetry],
    });
  });
});
