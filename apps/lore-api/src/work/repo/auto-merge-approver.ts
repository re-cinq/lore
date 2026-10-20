import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import type {
  BranchRule,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** What the save path reads to decide whether a repo may switch to lore-reviewer (specs/protected-branch-merge). */
export interface PrerequisiteSources {
  appInstalled: boolean;
  defaultBranch(): Promise<string>;
  getBranchRule(
    branch: string,
  ): Promise<
    Pick<
      BranchRule,
      "requiredApprovals" | "codeOwnersReview" | "requiredChecks"
    >
  >;
}

/** What is still missing before lore-reviewer may approve on this repo; empty when nothing is. */
export async function missingPrerequisites(
  sources: PrerequisiteSources,
): Promise<string[]> {
  const installation = sources.appInstalled ? [] : ["App installation"];
  const rule = await sources
    .defaultBranch()
    .then((branch) => sources.getBranchRule(branch))
    .catch(() => null);

  return [
    ...installation,
    ...(rule ? ruleGaps(rule) : ["ruleset access on the default branch"]),
  ];
}

export function ruleGaps(
  rule: Pick<
    BranchRule,
    "requiredApprovals" | "codeOwnersReview" | "requiredChecks"
  >,
): string[] {
  return [
    rule.requiredApprovals < 1 ? "ruleset requiring one approval" : "",
    rule.codeOwnersReview ? "" : "review from Code Owners",
    rule.requiredChecks.length > 0 ? "" : "the required CI checks",
  ].filter(Boolean);
}

export interface DisarmTargets {
  pulls: {
    list(): Promise<PullRef[]>;
    cancelAutoMerge(nodeId: string): Promise<void>;
  };
  audit: { write(entry: Omit<AuditLogEntry, "repo">): Promise<void> };
  /** Undefined where Lore runs on a plain token: then no PR is Lore's and nothing is disarmed. */
  appLogin: string | undefined;
}

/** Disarms native auto-merge on each open, armed PR opened by Lore's App, writing one `auto_merge_disarmed` audit row per PR GitHub actually disarmed. Returns the PRs it could not disarm. */
export async function disarmLorePulls({
  pulls,
  audit,
  appLogin,
}: DisarmTargets): Promise<number[]> {
  const armed = armedLorePulls(await pulls.list(), appLogin);
  const outcomes = await Promise.allSettled(
    armed.map(async ({ number, nodeId }) => {
      await pulls.cancelAutoMerge(nodeId);
      await audit.write({
        event_type: "auto_merge_disarmed",
        payload: { prNumber: number },
      });
    }),
  );

  return armed
    .filter((_, i) => outcomes[i].status === "rejected")
    .map(({ number }) => number);
}

function armedLorePulls(
  open: PullRef[],
  appLogin: string | undefined,
): Array<{ number: number; nodeId: string }> {
  return open.flatMap(({ number, nodeId, author, autoMerge }) =>
    isLores(author, appLogin) && autoMerge && nodeId
      ? [{ number, nodeId }]
      : [],
  );
}

function isLores(author: string | undefined, appLogin: string | undefined) {
  return appLogin !== undefined && author === appLogin;
}
