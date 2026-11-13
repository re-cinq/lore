import { describe, it, expect } from "vitest";
import {
  runBlockedReason,
  type BlockedReasonDeps,
  type ReasonEvent,
} from "./station.js";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";
import { Audit } from "@re-cinq/lore-shared/project/audit/audit.js";
import { InMemoryPrBlockedReasons } from "@re-cinq/lore-shared/project/pr-blocked-reasons/pr-blocked-reasons-memory.js";
import type {
  PullRef,
  CiConclusion,
  PullReview,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { InMemoryCommentThread } from "./comment-thread-memory.js";
import type {
  AuditPort,
  AuditLogEntry,
  StoredAuditLogEntry,
} from "@re-cinq/lore-shared/project/audit/audit-port.js";

const REPO = "re-cinq/lore";
const LORE = "lore-app[bot]";
const TASK_ID = "6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c";
const MERGED_AT = "2024-03-01T12:00:00Z";

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

const mergedEvent = (prNumber: number): ReasonEvent => ({
  name: "github.pull_request.closed",
  params: { repo: REPO, pr_number: prNumber, merged: true },
});

class BarrierAuditPort implements AuditPort {
  private waiters: (() => void)[] = [];

  constructor(private readonly real: InMemoryAudit) {}

  get entries(): AuditLogEntry[] {
    return this.real.entries;
  }

  write(entry: AuditLogEntry): Promise<void> {
    return this.real.write(entry);
  }

  listRecentByType(
    eventType: string,
    limit: number,
  ): Promise<StoredAuditLogEntry[]> {
    return this.real.listRecentByType(eventType, limit);
  }

  async hasEntry(
    eventType: string,
    repo: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    if (eventType === "pr_merged") {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);

        if (this.waiters.length === 2) {
          for (const w of this.waiters) {
            w();
          }
        }
      });
    }

    return this.real.hasEntry(eventType, repo, fields);
  }
}

function world(pulls: PullRef[]) {
  const ci = new Map<string, CiConclusion>();
  const realAudit = new InMemoryAudit();
  const auditPort = new BarrierAuditPort(realAudit);
  const reasons = new InMemoryPrBlockedReasons();
  const thread = new InMemoryCommentThread();
  const files = new Map<number, string[]>();
  const reviews = new Map<number, PullReview[]>();
  const repoFiles = new Map<string, string>();

  const deps: BlockedReasonDeps = {
    appLogin: async () => LORE,
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
        listReviews: async (number) => reviews.get(number) ?? [],
        listFiles: async (number) => files.get(number) ?? [],
      },
      repo: { read: async (path) => repoFiles.get(path) ?? null },
      issues: thread,
      audit: new Audit(repo, auditPort),
      taskIssue: async (taskId) => (taskId === TASK_ID ? 42 : null),
      autoMergeOn: async () => false,
      taskGroup: async () => undefined,
      hasReviewInFlight: async () => false,
    }),
  };

  return { deps, auditPort, files, reviews, repoFiles };
}

describe("runBlockedReason concurrency regression", () => {
  it("writes exactly one pr_merged row when processing overlapping identical merged closes", async () => {
    const w = world([
      pr(7, {
        state: "closed",
        mergedAt: MERGED_AT,
        body: `Adds it.

Lore-Task: ${TASK_ID}`,
      }),
    ]);

    w.files.set(7, ["src/a.ts"]);
    w.repoFiles.set("CODEOWNERS", "* @core");
    w.reviews.set(7, [
      {
        id: 1,
        body: "",
        user: "alice",
        state: "APPROVED",
        submitted_at: MERGED_AT,
      },
    ]);

    await Promise.all([
      runBlockedReason(mergedEvent(7), w.deps),
      runBlockedReason(mergedEvent(7), w.deps),
    ]);

    expect({
      entries: w.auditPort.entries,
      kpis: kpiContributions(w.auditPort.entries),
    }).toEqual({
      entries: [
        {
          event_type: "pr_merged",
          task_id: TASK_ID,
          repo: REPO,
          payload: {
            prNumber: 7,
            mergedAt: MERGED_AT,
            taskId: TASK_ID,
            sensitivePaths: ["src/a.ts"],
            approvedBy: ["alice"],
          },
        },
      ],
      kpis: [
        {
          pr_number: 7,
          merged_without_human: false,
          dependent_merged_before_dependency: false,
          sensitive_merged_without_codeowner: false,
          repo: REPO,
        },
      ],
    });
  });
});

function kpiContributions(entries: readonly AuditLogEntry[]) {
  return entries.filter(isKpiEvent).map((entry) => ({
    pr_number: Number(entry.payload.prNumber),
    merged_without_human: entry.event_type === "lore_reviewer_approved",
    dependent_merged_before_dependency: false,
    sensitive_merged_without_codeowner: isSensitiveWithoutCodeowner(entry),
    repo: entry.repo ?? null,
  }));
}

function isKpiEvent(entry: AuditLogEntry): boolean {
  return (
    entry.event_type === "lore_reviewer_approved" ||
    entry.event_type === "pr_merged"
  );
}

function isSensitiveWithoutCodeowner(entry: AuditLogEntry): boolean {
  const sensitivePaths = stringList(entry.payload.sensitivePaths);
  const approvedBy = stringList(entry.payload.approvedBy);

  return (
    entry.event_type === "pr_merged" &&
    sensitivePaths.length > 0 &&
    approvedBy.every((login) => login.endsWith("[bot]"))
  );
}

function stringList(list: unknown): string[] {
  return Array.isArray(list)
    ? list.filter((text): text is string => typeof text === "string")
    : [];
}
