import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

export interface DisarmTargets {
  pulls: {
    list(): Promise<PullRef[]>;
    cancelAutoMerge(nodeId: string): Promise<void>;
  };
  audit: { write(entry: Omit<AuditLogEntry, "repo">): Promise<void> };
  /** Undefined where Lore runs on a plain token: then no PR is Lore's by author. */
  appLogin: string | undefined;
  /** The pull requests the auto-merge loop worked, whoever opened them: it may have armed them. */
  loopPulls: ReadonlySet<number>;
}

/** Disarms native auto-merge on each open, armed PR Lore armed: one its App opened, or one the auto-merge loop worked. Writes one `auto_merge_disarmed` audit row per PR GitHub actually disarmed and returns the PRs it could not disarm. A PR a person armed themselves is left alone. */
export async function disarmLorePulls({
  pulls,
  audit,
  appLogin,
  loopPulls,
}: DisarmTargets): Promise<number[]> {
  const armed = armedLorePulls(await pulls.list(), { appLogin, loopPulls });
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
  armers: Pick<DisarmTargets, "appLogin" | "loopPulls">,
): Array<{ number: number; nodeId: string }> {
  return open.flatMap(({ number, nodeId, author, autoMerge }) =>
    (isLores(author, armers.appLogin) || armers.loopPulls.has(number)) &&
    autoMerge &&
    nodeId
      ? [{ number, nodeId }]
      : [],
  );
}

function isLores(author: string | undefined, appLogin: string | undefined) {
  return appLogin !== undefined && author === appLogin;
}
