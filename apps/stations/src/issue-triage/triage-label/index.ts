import type { Handle, RunningStation } from "@re-cinq/floor-station";
import { defineStation } from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { creditFailureOf } from "@re-cinq/lore-shared/loops/credit-failure.js";
import { projectFor } from "../../outbound/project-boot.js";

/** What each label node of the issue-triage line applies, and whether the verify pass's verdict is posted with it (specs/issue-triage FR17, FR23). A node absent here is not a label node, and the station says so rather than labelling the wrong thing. */
const TRIAGE_LABELS: Record<string, { label: string; postsVerdict: boolean }> =
  {
    "label-reproduced": {
      label: "triage: reproduced",
      postsVerdict: false,
    },
    "label-diagnosed": {
      label: "triage: diagnosed",
      postsVerdict: false,
    },
    "label-needs-repro": {
      label: "triage: needs-reproduction",
      postsVerdict: true,
    },
    "label-unable": {
      label: "triage: unable-to-reproduce",
      postsVerdict: true,
    },
    "label-skipped": { label: "triage: skipped", postsVerdict: false },
    "label-not-actionable": {
      label: "triage: not-actionable",
      postsVerdict: true,
    },
    "label-failed": { label: "triage: failed", postsVerdict: false },
  };

export interface TriageLabelIssues {
  comment(number: number, body: string): Promise<void>;
  addLabel(number: number, label: string): Promise<void>;
}

export interface TriageLabelDeps {
  /** Which node this visit is, since the label is the node's and a Brief carries no node id. */
  nodeOf(visitId: string): Promise<string | null>;
  /** Whether a station of this visit's run ran out of model credit: the loop is paused for it (specs/loop-pause FR4), and the issue must stay waiting for triage. */
  ranOutOfCredit(visitId: string): Promise<boolean>;
  issues(repo: string): Promise<TriageLabelIssues>;
}

const productionDeps: TriageLabelDeps = {
  nodeOf: async (visitId) =>
    (await floorClient().stationRuns.get(visitId))?.nodeId ?? null,
  ranOutOfCredit: async (visitId) => {
    const floor = floorClient();
    const visit = await floor.stationRuns.get(visitId);

    return visit
      ? creditFailureOf(await floor.stationRuns.list({ run: visit.runId })) !==
          null
      : false;
  },
  issues: async (repo) => (await projectFor(repo)).issues,
};

export function triageLabelHandle(deps: TriageLabelDeps): Handle {
  return async ({ visitId, needs }) => {
    const nodeId = await deps.nodeOf(visitId);
    const node = TRIAGE_LABELS[nodeId ?? ""];

    enforceTrue(
      node,
      Error,
      `no triage label is declared for node "${nodeId}"`,
    );

    if (!(await failedForWantOfCredit(deps, nodeId, visitId))) {
      await applyLabel(await deps.issues(needs.repo), node, needs);
    }

    return { outcome: "success" };
  };
}

const FAILED_NODE = "label-failed";

async function failedForWantOfCredit(
  deps: TriageLabelDeps,
  nodeId: string | null,
  visitId: string,
): Promise<boolean> {
  return nodeId === FAILED_NODE && deps.ranOutOfCredit(visitId);
}

async function applyLabel(
  issues: TriageLabelIssues,
  node: { label: string; postsVerdict: boolean },
  needs: Readonly<Record<string, string>>,
): Promise<void> {
  const issueNumber = Number(needs.issue_number);

  if (node.postsVerdict && needs.verdict) {
    await issues.comment(issueNumber, needs.verdict);
  }
  await issues.addLabel(issueNumber, node.label);
}

export function startTriageLabelStation(): RunningStation {
  return defineStation("triage-label", triageLabelHandle(productionDeps));
}
