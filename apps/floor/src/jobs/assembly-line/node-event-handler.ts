// Layer-3 handler for `kubernetes.agent_node.{succeeded,failed}` (spec 6-dark-factory
// FR6): one node CR went terminal → parse its outcome (LORE_NODE_RESULT /
// REVIEW_RESULT / phase precedence, reused from the station contract) → record it
// (CAS) → advance the line. The CR may already be pruned (terminal +1h) — the
// event's phase is the fallback, matching the poll path's no-output default.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  stationNodeOutcome,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import { graphForRun } from "./graph-for-run.js";
import type { EventHandler } from "../../main-loop/types.js";
import { advanceLine, type AdvanceDeps } from "./advance.js";
import { finishNodeTerminal, normalizeAgentStatus } from "./node-terminal.js";
import { notifyLineFailure } from "./notify-failure.js";
import { BillingAlertThrottle, maybeAlertBilling } from "./billing-alert.js";
import {
  codeReviewOnCommentTriaged,
  type CommentContext,
} from "../review/code-review.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";

export interface NodeEventDeps extends AdvanceDeps {
  /** Read the CR's status by name; null when it no longer exists (pruned). */
  readAgentStatus: (name: string) => Promise<AgentNodeStatus | null>;
  /** Fire the throttled operator alert when a CR failed because the Anthropic
   *  account ran dry (best-effort; optional so tests/partial deps omit it). */
  alertBilling?: (
    repo: string,
    nodeType: string,
    status: AgentNodeStatus,
  ) => Promise<void>;
}

export function createNodeEventHandler(deps: NodeEventDeps): EventHandler {
  return async (params) => {
    const assemblyLineId = String(params.assemblyLineId ?? "");
    const nodeId = String(params.nodeId ?? "");
    const agentName = String(params.agentName ?? "");
    const iteration =
      typeof params.iteration === "number" ? params.iteration : undefined;

    enforceTrue(
      assemblyLineId.length > 0 && nodeId.length > 0 && agentName.length > 0,
      Error,
      "kubernetes.agent_node event params missing assemblyLineId/nodeId/agentName",
    );

    const row = await deps.assemblyLines.getById(assemblyLineId);

    if (!row || row.status !== "running") {
      return;
    }

    const graph = await graphForRun(row, deps.definitions);
    const node = graph?.nodes.find((n) => n.id === nodeId);

    if (!node) {
      return;
    }

    // Unwrap the NDJSON envelope once, here: every text parser below (the outcome
    // precedence and the review findings alike) must read the agent text, not the
    // stream that carries it.
    const status = normalizeAgentStatus(
      (await deps.readAgentStatus(agentName)) ?? {
        phase: String(params.phase ?? ""),
      },
    );
    const result = stationNodeOutcome(node, status);

    // An account-out-of-credits failure downs every LLM node at once; surface it
    // once to operators (the seam throttles + classifies) before the per-line
    // failure notice, which only ever carries a routing reason.
    if (result.outcome === "failed" && deps.alertBilling) {
      await deps.alertBilling(row.repo, node.type, status);
    }

    await finishNodeTerminal(
      { row, node, nodeId, iteration, result, output: status.output },
      deps,
    );

    await routeCommentTriage(row, nodeId, result);
  };
}

/** When a comment-triage node goes terminal, read its classified action and start
 *  the routed follow-up line. Best-effort — a routing failure never fails the walk. */
async function routeCommentTriage(
  row: AssemblyRunRecord,
  nodeId: string,
  result: NodeResult,
): Promise<void> {
  if (row.blueprintName !== "comment-triage" || nodeId !== "triage") {
    return;
  }
  const action = result.extras?.action;

  if (!action) {
    return;
  }

  try {
    await codeReviewOnCommentTriaged({
      action,
      context: contextFromRow(row),
    });
  } catch (err) {
    console.warn(
      "[code-review] triage routing failed:",
      (err as Error).message,
    );
  }
}

function contextFromRow(row: AssemblyRunRecord): CommentContext {
  const a = row.args;

  return {
    repo: row.repo,
    pr_number: Number(a.pr_number) || 0,
    branch: row.branch ?? "",
    head_sha: typeof a.head_sha === "string" ? a.head_sha : undefined,
    comment_id: Number(a.comment_id) || 0,
    comment_body: String(a.comment_body ?? ""),
    in_reply_to_id:
      typeof a.in_reply_to_id === "number" ? a.in_reply_to_id : null,
  };
}

/** Re-exported for the start handler / reaper compositions. */
export { advanceLine };

/** Production deps, resolved lazily so importing the registry never forces the DB
 *  pool or the K8s client. Shared by the node-event handler, the start handler's
 *  advance, and the reaper tick. */
export async function productionNodeEventDeps(): Promise<NodeEventDeps> {
  const [
    { assemblyLines, jobRuns, taskStore, conversations },
    { loadBuiltinAssemblyLines },
    { agentCrBackend, projectFor },
    { buildPrompt },
    { cleanupPerTaskToken },
    { KubeAgentApi },
    { settleTaskForLine },
    { resolveConversation },
    { stampLinePr },
  ] = await Promise.all([
    import("../../kernel/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("../../composition/project-boot.js"),
    import("../../kernel/config.js"),
    import("../watcher/agent-watcher.js"),
    import("../station/kube-agent-api.js"),
    import("./settle-task.js"),
    import("./resolve-conversation.js"),
    import("./spec-pr.js"),
  ]);
  const kubeApi = new KubeAgentApi();

  return {
    assemblyLines: assemblyLines(),
    definitions: loadBuiltinAssemblyLines,
    launch: async (spec) => {
      await agentCrBackend().launch(spec);
    },
    resolvePrompt: buildPrompt,
    cleanupToken: cleanupPerTaskToken,
    jobRuns: jobRuns(),
    notifyFailure: notifyLineFailure,
    resolveConversation: (node, task, iteration, priorOutcome) =>
      resolveConversation(
        node,
        task,
        iteration,
        {
          conversations: conversations(),
          // The URL the POD must reach, which is the same sink host it already posts
          // telemetry to — not the Floor's own view of itself.
          registryUrl: `${process.env.LORE_FLOOR_POD_URL ?? ""}/api/agent-conversations`,
          headersSecret: "agent-events-auth",
          // Rewind: `args.resume_from_task` names the round the author chose, and the
          // conversation it reserved is keyed by the assembly line that ran it.
          linesForTask: async (taskId) =>
            (await assemblyLines().listForTask(taskId)).map((line) => line.id),
        },
        priorOutcome,
      ),
    settleTask: (row, outcome, reason) =>
      settleTaskForLine(row, outcome, reason, {
        tasks: taskStore(),
        featuresFor: projectFor,
      }),
    stampPr: async (row) => {
      const project = await projectFor(row.repo);

      await stampLinePr(row, {
        pulls: project.pulls,
        assemblyLines: assemblyLines(),
        features: project.features,
      });
    },
    readAgentStatus: (name) => kubeApi.getStatus(name),
    alertBilling: async (repo, nodeType, status) => {
      await maybeAlertBilling(repo, nodeType, status, {
        notify: async (level, message) =>
          (await projectFor(repo)).notify.notify(level, message),
        throttle: billingAlertThrottle,
      });
    },
  };
}

/** Module singleton: the billing outage is account-wide, so the alert throttle
 *  must survive across per-event deps (one alert/hour across all repos). */
const billingAlertThrottle = new BillingAlertThrottle();

/** Composed production handler for the registry (both node-terminal events). */
export const agentNodeTerminal: EventHandler = async (params) => {
  const handler = createNodeEventHandler(await productionNodeEventDeps());

  return handler(params);
};
