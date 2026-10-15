import { describe, it, expect } from "vitest";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";
import { Audit } from "@re-cinq/lore-shared/project/audit/audit.js";
import type { AppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { InMemoryPrBlockedReasons } from "@re-cinq/lore-shared/project/pr-blocked-reasons/pr-blocked-reasons-memory.js";
import type {
  CiConclusion,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { blockedReasonComment } from "./comment.js";
import { InMemoryCommentThread } from "./comment-thread-memory.js";
import {
  runBlockedReason,
  type BlockedReasonDeps,
  type ReasonEvent,
} from "./station.js";

const REPO = "re-cinq/lore";
const LORE = "lore-app[bot]";
const TASK_ID = "6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c";

const pr = (number: number, fields: Partial<PullRef> = {}): PullRef => ({
  repo: REPO,
  number,
  title: `PR ${number}`,
  branch: `lore/${number}`,
  state: "open",
  labels: [],
  url: `https://github.com/${REPO}/pull/${number}`,
  author: LORE,
  headSha: `sha${number}`,
  baseBranch: "main",
  ...fields,
});

function world(pulls: PullRef[], appLogin: AppLogin = async () => LORE) {
  const ci = new Map<string, CiConclusion>();
  const audit = new InMemoryAudit();
  const reasons = new InMemoryPrBlockedReasons();
  const thread = new InMemoryCommentThread();
  const deps: BlockedReasonDeps = {
    appLogin,
    reasons,
    project: async (repo) => ({
      pulls: {
        get: async (number) => pulls.find((p) => p.number === number) ?? null,
        list: async () => pulls,
        getMergeability: async () => ({ mergeable: true, state: "clean" }),
        getBranchRule: async () => ({
          requiredApprovals: 0,
          codeOwnersReview: false,
          requiredChecks: [],
        }),
        listChecks: async () => [],
        ciConclusion: async (ref) => ci.get(ref) ?? "success",
        listReviews: async () => [],
      },
      issues: thread,
      audit: new Audit(repo, audit),
      taskIssue: async (taskId) => (taskId === TASK_ID ? 42 : null),
    }),
  };

  return { deps, ci, audit, reasons, thread };
}

const prEvent = (action: string, prNumber: number): ReasonEvent => ({
  name: `github.pull_request.${action}`,
  params: { repo: REPO, pr_number: prNumber },
});

const WAITING = blockedReasonComment({ reason: "waiting_on_ci", detail: null });

describe("runBlockedReason", () => {
  it("records waiting_on_ci for Lore's PR 7 with pending CI, audits it once and posts one comment", async () => {
    const w = world([pr(7)]);

    w.ci.set("sha7", "pending");
    await runBlockedReason(prEvent("opened", 7), w.deps);

    expect({
      current: await w.reasons.current(REPO, 7),
      audited: w.audit.entries,
      comments: w.thread.comments,
    }).toEqual({
      current: { reason: "waiting_on_ci", detail: null },
      audited: [
        {
          event_type: "pr_blocked_reason",
          repo: REPO,
          payload: {
            prNumber: 7,
            from: null,
            to: "waiting_on_ci",
            detail: null,
          },
        },
      ],
      comments: [{ number: 7, id: 1, body: WAITING }],
    });
  });

  it("writes nothing more when the same synchronize for PR 7 is delivered twice", async () => {
    const w = world([pr(7)]);

    w.ci.set("sha7", "pending");
    await runBlockedReason(prEvent("synchronize", 7), w.deps);
    const summary = await runBlockedReason(prEvent("synchronize", 7), w.deps);

    expect({
      summary,
      audited: w.audit.entries.length,
      comments: w.thread.comments.length,
      edits: w.thread.edits,
    }).toEqual({
      summary: "#7 unchanged",
      audited: 1,
      comments: 1,
      edits: [],
    });
  });

  it("clears PR 7's row and edits its comment to say nothing blocks once CI turns green", async () => {
    const w = world([pr(7)]);

    w.ci.set("sha7", "pending");
    await runBlockedReason(prEvent("opened", 7), w.deps);
    w.ci.set("sha7", "success");
    await runBlockedReason(prEvent("synchronize", 7), w.deps);

    expect({
      current: await w.reasons.current(REPO, 7),
      lastAudit: w.audit.entries.at(-1)?.payload,
      comments: w.thread.comments,
    }).toEqual({
      current: null,
      lastAudit: { prNumber: 7, from: "waiting_on_ci", to: null, detail: null },
      comments: [{ number: 7, id: 1, body: blockedReasonComment(null) }],
    });
  });

  it("writes nothing for PR 7 when it is clear and was never blocked", async () => {
    const w = world([pr(7)]);

    await runBlockedReason(prEvent("opened", 7), w.deps);

    expect({
      rows: w.reasons.rows.size,
      audited: w.audit.entries,
      comments: w.thread.comments,
    }).toEqual({ rows: 0, audited: [], comments: [] });
  });

  it("leaves alice's PR 8 alone even though its CI is pending", async () => {
    const w = world([pr(8, { author: "alice" })]);

    w.ci.set("sha8", "pending");
    const summary = await runBlockedReason(prEvent("opened", 8), w.deps);

    expect({
      summary,
      rows: w.reasons.rows.size,
      comments: w.thread.comments,
    }).toEqual({ summary: "no Lore PR to read", rows: 0, comments: [] });
  });

  it("does nothing when Lore runs on a plain token with no App login", async () => {
    const w = world([pr(7)], async () => undefined);

    w.ci.set("sha7", "pending");

    expect(await runBlockedReason(prEvent("opened", 7), w.deps)).toBe(
      "no Lore App login: no PR is Lore's",
    );
    expect(w.reasons.rows.size).toBe(0);
  });

  it("closes PR 7's row on pull_request.closed without touching its comment", async () => {
    const w = world([pr(7)]);

    w.ci.set("sha7", "pending");
    await runBlockedReason(prEvent("opened", 7), w.deps);
    await runBlockedReason(prEvent("closed", 7), w.deps);

    expect({
      current: await w.reasons.current(REPO, 7),
      closed: w.reasons.rows.get(`${REPO}#7`)?.closedAt instanceof Date,
      comments: w.thread.comments,
      edits: w.thread.edits,
    }).toEqual({
      current: null,
      closed: true,
      comments: [{ number: 7, id: 1, body: WAITING }],
      edits: [],
    });
  });

  it("reads PRs 7 and 8 from a completed check suite and records only Lore's PR 7", async () => {
    const w = world([pr(7), pr(8, { author: "alice" })]);

    w.ci.set("sha7", "pending");
    w.ci.set("sha8", "pending");
    await runBlockedReason(
      {
        name: "github.check_suite.completed",
        params: { repo: REPO, head_sha: "sha7", pr_numbers: [7, 8] },
      },
      w.deps,
    );

    expect([...w.reasons.rows.keys()]).toEqual([`${REPO}#7`]);
  });

  it("re-reads open PR 7 on a push to its base main and skips PR 9 based on release", async () => {
    const w = world([pr(7), pr(9, { baseBranch: "release" })]);

    w.ci.set("sha7", "pending");
    w.ci.set("sha9", "pending");
    await runBlockedReason(
      { name: "github.push", params: { repo: REPO, branch: "main" } },
      w.deps,
    );

    expect([...w.reasons.rows.keys()]).toEqual([`${REPO}#7`]);
  });

  it("posts the same comment on backlog issue 42 of the task named by PR 7's Lore-Task line", async () => {
    const w = world([pr(7, { body: `Adds it.\n\nLore-Task: ${TASK_ID}` })]);

    w.ci.set("sha7", "pending");
    await runBlockedReason(prEvent("opened", 7), w.deps);

    expect(w.thread.comments).toEqual([
      { number: 7, id: 1, body: WAITING },
      { number: 42, id: 2, body: WAITING },
    ]);
  });

  it("leaves Lore's draft PR 7 alone while it is still a draft, CI pending or not", async () => {
    const w = world([pr(7, { draft: true })]);

    w.ci.set("sha7", "pending");
    const summary = await runBlockedReason(prEvent("synchronize", 7), w.deps);

    expect({
      summary,
      rows: w.reasons.rows.size,
      comments: w.thread.comments,
    }).toEqual({ summary: "no Lore PR to read", rows: 0, comments: [] });
  });
});
