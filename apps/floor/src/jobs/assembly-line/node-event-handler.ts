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
import type { EventHandler } from "../../main-loop/types.js";
import {
  advanceLine,
  finishNodeAndAdvance,
  type AdvanceDeps,
} from "./advance.js";
import {
  codeReviewOnCommentTriaged,
  type CommentContext,
} from "../review/code-review.js";
import { maybePostReview } from "../review/post-review.js";
import { publishPrCheck } from "./pr-check.js";
import { projectFor } from "../../composition/project-boot.js";
import type { AssemblyLineRecord } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import type { AssemblyLineNode, NodeResult } from "@re-cinq/lore-assembly-lines";

export interface NodeEventDeps extends AdvanceDeps {
  /** Read the CR's status by name; null when it no longer exists (pruned). */
  readAgentStatus: (name: string) => Promise<AgentNodeStatus | null>;
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

    const definition = (await deps.definitions()).get(row.definitionName);
    const node = definition?.nodes.find((n) => n.id === nodeId);

    if (!definition || !node) {
      return;
    }

    const status = (await deps.readAgentStatus(agentName)) ?? {
      phase: String(params.phase ?? ""),
    };
    const result = stationNodeOutcome(node, status);

    await finishNodeAndAdvance(
      { assemblyLineId, nodeId, iteration, result },
      deps,
    );

    await postReviewFromNode(row, node, status.output);
    await routeCommentTriage(row, nodeId, result);
    await publishCheck(assemblyLineId, deps);
  };
}

/** A review node emits structured findings instead of posting; render + post them here. */
async function postReviewFromNode(
  row: AssemblyLineRecord,
  node: AssemblyLineNode,
  output?: string,
): Promise<void> {
  if (node.prompt_ref !== "code-review") {
    return;
  }
  const prNumber = Number(row.args.pr_number) || 0;

  if (!prNumber) {
    return;
  }

  try {
    const project = await projectFor(row.repo);

    await maybePostReview(project.pulls, prNumber, output ?? "");
  } catch (err) {
    console.warn("[code-review] post review failed:", (err as Error).message);
  }
}

/** Publish the line's current state as a PR check (in_progress while running,
 *  terminal once finished). Best-effort — a missing `checks: write` never blocks. */
async function publishCheck(
  assemblyLineId: string,
  deps: NodeEventDeps,
): Promise<void> {
  const row = await deps.assemblyLines.getById(assemblyLineId);

  if (!row || !(Number(row.args.pr_number) > 0)) {
    return;
  }
  const project = await projectFor(row.repo);

  await publishPrCheck(project.repo, row, process.env.LORE_UI_URL);
}

/** When a comment-triage node goes terminal, read its classified action and start
 *  the routed follow-up line. Best-effort — a routing failure never fails the walk. */
async function routeCommentTriage(
  row: AssemblyLineRecord,
  nodeId: string,
  result: NodeResult,
): Promise<void> {
  if (row.definitionName !== "comment-triage" || nodeId !== "triage") {
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
    console.warn("[code-review] triage routing failed:", (err as Error).message);
  }
}

function contextFromRow(row: AssemblyLineRecord): CommentContext {
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
    { assemblyLines, jobRuns },
    { loadBuiltinAssemblyLines },
    { agentCrBackend },
    { buildPrompt },
    { cleanupPerTaskToken },
    { KubeAgentApi },
  ] = await Promise.all([
    import("../../kernel/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("../../composition/project-boot.js"),
    import("../../kernel/config.js"),
    import("../watcher/agent-watcher.js"),
    import("../station/kube-agent-api.js"),
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
    readAgentStatus: (name) => kubeApi.getStatus(name),
  };
}

/** Composed production handler for the registry (both node-terminal events). */
export const agentNodeTerminal: EventHandler = async (params) => {
  const handler = createNodeEventHandler(await productionNodeEventDeps());

  return handler(params);
};
