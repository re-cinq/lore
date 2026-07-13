import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect, vi } from "vitest";
import {
  escalate,
  renderEscalationBody,
  type IssueCreator,
} from "./escalation.js";

// Avoid touching the real DB / audit log in unit tests.
vi.mock("../../kernel/db.js", () => ({
  query: vi.fn(async () => []),
}));

function mockIssues(
  opts: {
    failures?: number;
    alwaysFails?: boolean;
  } = {},
): {
  issues: IssueCreator;
  createCalls: Array<{ title: string; body: string; labels?: string[] }>;
} {
  const createCalls: Array<{ title: string; body: string; labels?: string[] }> =
    [];
  let attempts = 0;
  const create = vi.fn(
    async (title: string, body: string, labels?: string[]) => {
      createCalls.push({ title, body, labels });
      attempts++;
      enforceTrue(!opts.alwaysFails, new Error("github 503"));
      enforceTrue(
        !(opts.failures && attempts <= opts.failures),
        new Error("transient 502"),
      );
      return { number: 42, url: "https://github.com/owner/repo/issues/42" };
    },
  );
  return { issues: { create }, createCalls };
}

describe("renderEscalationBody", () => {
  it("includes branch link, commit log link, diagnostic", () => {
    const body = renderEscalationBody({
      taskId: "t-1",
      repo: "owner/repo",
      branchName: "lore/feature/x",
      reason: "iteration_max_exceeded",
      diagnostic: "Review went 3 rounds without convergence",
    });
    expect(body).toContain("**Task ID:** `t-1`");
    expect(body).toContain(
      "(https://github.com/owner/repo/tree/lore%2Ffeature%2Fx)",
    );
    expect(body).toContain(
      "(https://github.com/owner/repo/commits/lore%2Ffeature%2Fx)",
    );
    expect(body).toContain("`iteration_max_exceeded`");
    expect(body).toContain("Review went 3 rounds without convergence");
  });

  it("includes failing phase output and contributing refs when provided", () => {
    const body = renderEscalationBody({
      taskId: "t-1",
      repo: "owner/repo",
      branchName: "b",
      reason: "validation_failed_twice",
      diagnostic: "lint failed twice",
      failingPhaseOutput: "ERROR: ‘x’ is not defined\nERROR: ...",
      contributingRefs: [
        { type: "fact", id: "f-1", text: "Use ESLint v9" },
        { type: "memory", id: "m-2" },
      ],
    });
    expect(body).toContain("### Failing phase output");
    expect(body).toContain("ERROR: ‘x’ is not defined");
    expect(body).toContain("- fact `f-1`: Use ESLint v9");
    expect(body).toContain("- memory `m-2`");
  });
});

describe("escalate — issue_created path", () => {
  it("creates an Issue and notifies on success", async () => {
    const { issues, createCalls } = mockIssues();
    const notifyCalls: Array<{ msg: string; level: string }> = [];

    const r = await escalate({
      taskId: "t-1",
      repo: "owner/repo",
      branchName: "lore/feature/x",
      reason: "iteration_max_exceeded",
      diagnostic: "stuck",
      issues,
      notify: (msg, level) => {
        notifyCalls.push({ msg, level });
      },
    });

    expect(r.outcome).toBe("issue_created");
    expect(r.issueNumber).toBe(42);
    expect(r.issueUrl).toBe("https://github.com/owner/repo/issues/42");
    expect(createCalls).toHaveLength(1);

    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].level).toBe("escalation");
    expect(notifyCalls[0].msg).toContain("/issues/42");
    expect(notifyCalls[0].msg).not.toContain("Issue creation failed");
  });

  it("creates Issue with both labels needs-human-help + lore-managed", async () => {
    const { issues, createCalls } = mockIssues();
    await escalate({
      taskId: "t",
      repo: "owner/repo",
      branchName: "b",
      reason: "supervisor_panic",
      diagnostic: "d",
      issues,
    });
    const args = createCalls[0] as { labels: string[] };
    expect(args.labels.sort()).toEqual(["lore-managed", "needs-human-help"]);
  });
});

describe("escalate — retry then success", () => {
  it("retries on transient failure and succeeds on the 2nd attempt", async () => {
    // Two failures means 1st throws, 2nd throws, 3rd succeeds. Cap our
    // failure count at 1 so the 2nd attempt succeeds — we don't want
    // tests waiting on the 4s + 16s sleeps.
    const { issues, createCalls } = mockIssues({ failures: 1 });
    // Stub setTimeout to skip backoff sleeps.
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    const r = await escalate({
      taskId: "t",
      repo: "owner/repo",
      branchName: "b",
      reason: "supervisor_panic",
      diagnostic: "d",
      issues,
    });
    expect(r.outcome).toBe("issue_created");
    expect(createCalls).toHaveLength(2);

    vi.restoreAllMocks();
  });
});

describe("escalate — audit_only fallback (T041)", () => {
  it("degrades to audit_only after 2 attempts and inlines body to Slack", async () => {
    const { issues, createCalls } = mockIssues({ alwaysFails: true });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    const notifyCalls: Array<{ msg: string; level: string }> = [];
    const r = await escalate({
      taskId: "t",
      repo: "owner/repo",
      branchName: "b",
      reason: "validation_failed_twice",
      diagnostic: "lint kept failing",
      issues,
      notify: (msg, level) => {
        notifyCalls.push({ msg, level });
      },
    });

    expect(r.outcome).toBe("audit_only");
    expect(r.issueNumber).toBeUndefined();
    // 3 attempts (initial + 1s + 4s tail): the shared withBackoff runs
    // delaysMs.length + 1 tries, so [1000, 4000] means three creates.
    expect(createCalls).toHaveLength(3);

    // Slack message must carry the full body since the Issue surface
    // failed.
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].msg).toContain("Issue creation failed");
    expect(notifyCalls[0].msg).toContain("## Lore Pipeline Escalation");
    expect(notifyCalls[0].msg).toContain("lint kept failing");

    vi.restoreAllMocks();
  });
});

describe("escalate — no notifier configured", () => {
  it("returns without calling Slack when notify is omitted", async () => {
    const { issues } = mockIssues();
    const r = await escalate({
      taskId: "t",
      repo: "owner/repo",
      branchName: "b",
      reason: "supervisor_panic",
      diagnostic: "d",
      issues,
    });
    expect(r.outcome).toBe("issue_created");
  });
});
