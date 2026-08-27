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
import { resolveRunGraph } from "@re-cinq/lore-assembly-lines";
import type { EventHandler } from "../../main-loop/types.js";
import { advanceLine, type AdvanceDeps } from "./advance.js";
import { HttpAgentApi } from "@re-cinq/lore-shared";
import { clusterAgent } from "../../kernel/queues.js";
import { finishNodeTerminal, normalizeAgentStatus } from "./node-terminal.js";
import { notifyLineFailure } from "./notify-failure.js";
import { BillingAlertThrottle, maybeAlertBilling } from "./billing-alert.js";
import { llmDispatchGate } from "./llm-dispatch-gate.js";
import { artifactsFromTerminalOutput } from "../agent/artifact-args.js";
import {
  codeReviewOnCommentTriaged,
  type CommentContext,
} from "../review/code-review.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";

export interface NodeEventDeps extends AdvanceDeps {
  /** Read the CR's status by name; null when it no longer exists (pruned) — or
   *  when it lives in a cluster this Floor cannot reach, which is a different
   *  fact wearing the same null. {@link agentCrVisible} tells them apart. */
  readAgentStatus: (name: string) => Promise<AgentNodeStatus | null>;
  /** The central cluster's registered agent id. Resolved per call — the id is
   *  minted at registration, so a static env var cannot know it. Omitted or
   *  null leaves only legacy `running` rows visible, which is exactly the
   *  pre-claim-path behaviour. */
  centralClusterAgentId?: () => Promise<string | null>;
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
    const assemblyLineId = String(
      params.assemblyRunId ?? params.assemblyLineId ?? "",
    );
    const nodeId = String(params.nodeId ?? "");
    const agentName = String(params.agentName ?? "");
    const iteration =
      typeof params.iteration === "number" ? params.iteration : undefined;

    enforceTrue(
      assemblyLineId.length > 0 && nodeId.length > 0 && agentName.length > 0,
      Error,
      "kubernetes.agent_node event params missing assemblyLineId/nodeId/agentName",
    );

    const row = await deps.assemblyRuns.getById(assemblyLineId);

    if (!row || row.status !== "running") {
      return;
    }

    const graph = await resolveRunGraph(row, deps.definitions);
    const node = graph?.nodes.find((n) => n.id === nodeId);

    if (!node) {
      return;
    }

    // Unwrap the NDJSON envelope once, here: every text parser below (the outcome
    // precedence and the review findings alike) must read the agent text, not the
    // stream that carries it.
    const rawStatus = (await deps.readAgentStatus(agentName)) ?? {
      phase: String(params.phase ?? ""),
    };
    const status = normalizeAgentStatus(rawStatus);
    // Delivery rides the advancing event, and lands BEFORE the walk moves: the
    // sink these artifacts normally arrive on is a separate HTTP post racing this
    // one, so nothing ordered the merge before the next node's dispatch, and the
    // next station could read an arg its predecessor had already produced and
    // simply not find it. Merging the same content twice is a no-op, so the sink
    // stays the fast path.
    const result = await deliverTerminalArtifacts(row, node, rawStatus, deps);

    // An account-out-of-credits failure downs every LLM node at once; surface it
    // once to operators (the seam throttles + classifies) before the per-line
    // failure notice, which only ever carries a routing reason.
    if (result.outcome === "failed" && deps.alertBilling) {
      await deps.alertBilling(row.repo, node.type, status);
    }
    tripGateOnAccountOutage(result, deps);

    await finishNodeTerminal(
      { row, node, nodeId, iteration, result, output: status.output },
      deps,
    );
  };
}

/**
 * Merge the artifacts a terminal node declared, then decide its outcome.
 *
 * Shared by BOTH terminal doors — the node event and the reaper's resolve — because
 * a dropped event means the reaper is the only one who will ever see this output,
 * and an artifact delivered on one door but not the other is a difference nobody
 * could predict from the run.
 *
 * A declared artifact the agent never produced FAILS the node: advancing hands the
 * next station an empty bag, which it reads as "my predecessor decided nothing"
 * rather than as the delivery failure it is.
 */
export async function deliverTerminalArtifacts(
  row: AssemblyRunRecord,
  node: { type: string },
  rawStatus: AgentNodeStatus,
  deps: Pick<AdvanceDeps, "assemblyRuns">,
): Promise<NodeResult> {
  const { args, missing } = artifactsFromTerminalOutput(rawStatus.output);

  if (Object.keys(args).length > 0) {
    await deps.assemblyRuns.mergeArgs(row.id, args);
  }
  const result = stationNodeOutcome(node, normalizeAgentStatus(rawStatus));

  if (missing.length === 0 || result.outcome === "failed") {
    return result;
  }
  const detail = `declared artifact not produced: ${missing.join(", ")}`;

  return {
    outcome: "failed",
    failureClass: "unknown",
    failureDetail: detail,
    extras: { "Lore-Validation-Summary": detail },
  };
}

/**
 * Stop dispatching agent nodes when THIS failure says the account, not the run,
 * is down. The gate decides which classes qualify; every other failure passes
 * through untouched. Logged only on the transition, because the whole point is
 * that an account outage produces one event and not one per drowned run.
 */
function tripGateOnAccountOutage(
  result: NodeResult,
  deps: NodeEventDeps,
): void {
  if (!result.failureClass) {
    return;
  }

  if (deps.llmGate?.trip(result.failureClass, result.failureDetail)) {
    console.warn(
      `[llm-dispatch-gate] pausing agent dispatch: ${result.failureDetail ?? result.failureClass}`,
    );
  }
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
    {
      pipeline,
      taskStore,
      conversations,
      eventReporter,
      memoryLifecycle,
      settings,
    },
    { loadBuiltinAssemblyLines },
    { projectFor },
    { buildNodePrompt },
    { cleanupPerTaskToken },
    { settleTaskForLine },
    { resolveConversation },
    { stampLinePr },
  ] = await Promise.all([
    import("../../kernel/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("../../composition/project-boot.js"),
    import("../../kernel/config.js"),
    import("../watcher/agent-watcher.js"),
    import("./settle-task.js"),
    import("./resolve-conversation.js"),
    import("./spec-pr.js"),
  ]);
  const cluster = new HttpAgentApi(clusterAgent());

  return {
    assemblyRuns: pipeline().assemblyRuns,
    definitions: loadBuiltinAssemblyLines,
    // Wired HERE so it reaches every door: the CR event, the reaper's resolve,
    // and a station reporting over `assembly_run.resume`. It used to be called
    // by the CR handler alone, so a triage node the REAPER resolved never
    // started its follow-up, silently.
    onNodeFinished: routeCommentTriage,
    // The enqueue-time half of FR2: `resolveRequiredTags` reads the repo's
    // `station_default_tags` from this raw settings object.
    repoSettings: (repo) => settings().rawSettings(repo),
    // Strict: a node's prompt_ref names the recipe it runs, so an unknown one
    // fails the node instead of silently running `general` (#1329).
    resolvePrompt: buildNodePrompt,
    cleanupToken: cleanupPerTaskToken,
    jobRuns: pipeline().jobRuns,
    notifyFailure: notifyLineFailure,
    onRunClosed: async (run, outcome, reason) => {
      const { loopRunClosed } = await import("../backlog/loop-run-closed.js");

      await loopRunClosed(run, outcome, reason);
    },
    // Publish a service-form node for the pooled stations service to claim,
    // rather than giving a DB write or an HTTP POST a pod of its own.
    publishNode: (event) =>
      eventReporter().insert({ ...event, source: "internal" }),
    // What the retrospective station was for and never did: every blueprint names
    // it as the EXIT, and the walk finishes at the exit rather than dispatching
    // it, so no run has ever written one.
    recordRunEpisode: async (run, outcome, reason) => {
      const { writeEpisode } = await import("@re-cinq/lore-shared");

      await writeEpisode(
        { memory: memoryLifecycle() },
        [
          `Assembly run ${run.blueprintName} on ${run.repo} ${outcome}.`,
          `Branch: ${run.branch ?? "(none)"}`,
          reason ? `Reason: ${reason}` : "",
        ]
          .filter((l) => l.length > 0)
          .join("\n"),
        "assembly-run",
        `${run.repo}/${run.id}`,
      );
    },
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
            (await pipeline().assemblyRuns.listForTask(taskId)).map(
              (line) => line.id,
            ),
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
        assemblyRuns: pipeline().assemblyRuns,
        features: project.features,
      });
    },
    readAgentStatus: (name) => cluster.getStatus(name),
    llmGate: llmDispatchGate,
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
