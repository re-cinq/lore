// Layer-3 handler for `kubernetes.agent_node.{succeeded,failed}` (spec 6-dark-factory
// FR6): one node CR went terminal → parse its outcome (LORE_NODE_RESULT /
// REVIEW_RESULT / phase precedence, reused from the station contract) → record it
// (CAS) → advance the line. The CR may already be pruned (terminal +1h) — the
// event's phase is the fallback, matching the poll path's no-output default.
//
// Since specs/running-stations-in-any-k8s-cluster FR4's follow-up, the event
// itself may already carry the CR's status (`params.status`, reported by
// cluster-agent at the source — see `project/events/k8s-map.ts`). When it
// does, that IS the answer: no central-only read, no visibility gate, because
// there is nothing left to interrogate a cluster for. Only an event from an
// older, not-yet-redeployed cluster-agent (no `status` in its params) falls
// through to the pre-existing central read + reaper handoff.

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
import { isDeliveringRecipe } from "@re-cinq/lore-shared/task-types/delivering-recipes.js";
import { agentCrVisible } from "./cr-visibility.js";
import { notifyLineFailure } from "./notify-failure.js";
import { BillingAlertThrottle, maybeAlertBilling } from "./billing-alert.js";
import { maybeAlertAgentConfig } from "./agent-config-alert.js";
import { llmDispatchGate } from "./llm-dispatch-gate.js";
import { artifactsFromTerminalOutput } from "../agent/artifact-args.js";
import {
  codeReviewOnCommentTriaged,
  type CommentContext,
} from "../review/code-review.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";

export interface NodeEventDeps extends AdvanceDeps {
  /** Read the CR's status by name; null when it no longer exists (pruned) — or
   *  when it lives in a cluster this Floor cannot reach, which is a different
   *  fact wearing the same null. {@link agentCrVisible} tells them apart. */
  readAgentStatus: (name: string) => Promise<AgentNodeStatus | null>;
  /**
   * How much a run's branch differs from the repo's default branch — what a
   * DELIVERING node (one whose job is to change the branch) is held to. Zero
   * turns its reported success into a failure. Optional seam: a composition
   * without it trusts the node's own word, which is the pre-2026-08-30
   * behaviour.
   */
  deliveredChangeCount?: (repo: string, branch: string) => Promise<number>;
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
  /** Fire the throttled operator alert when a CR failed because an
   *  AgentDefinition's skills_source was unreachable — every Claude-agent node
   *  the affected cluster claims fails identically until it is fixed
   *  (best-effort; optional so tests/partial deps omit it). */
  alertAgentConfig?: (
    repo: string,
    nodeType: string,
    status: AgentNodeStatus,
  ) => Promise<void>;
}

/**
 * The event's own reported `AgentNodeStatus` (specs/running-stations-in-any-k8s-cluster
 * FR4's follow-up), or null when the reporter did not send one — an older
 * cluster-agent, still on the read-back path. Narrowed defensively: `params`
 * is untyped JSONB off the wire, not a value this process minted.
 */
export function reportedStatus(status: unknown): AgentNodeStatus | null {
  if (!isRecord(status)) {
    return null;
  }

  return {
    ...(typeof status.phase === "string" ? { phase: status.phase } : {}),
    ...(typeof status.output === "string" ? { output: status.output } : {}),
    ...(typeof status.failureReason === "string"
      ? { failureReason: status.failureReason }
      : {}),
  };
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

    const reported = reportedStatus(params.status);

    // Only when the event carries no status of its own (an older cluster-agent
    // that has not been redeployed yet) does this Floor need to interrogate a
    // cluster at all. A CR it cannot interrogate answers null, and the
    // fallback below would read that null as "the agent produced nothing" —
    // the opposite of what it means. A review node degraded that way tells
    // the PR its review "never got far enough to judge the diff" while the
    // agent's own output ended in REVIEW_RESULT:APPROVED (2026-08-27, every
    // review on this repo, for as long as the central cluster stayed paused).
    //
    // So: hand the row to the reaper, which is already cluster-aware — it waits
    // the node's budget, requeues if the claimant dies, and times out honestly
    // if it does not. Nothing is fabricated from an output nobody read.
    const leftToReaper =
      reported === null &&
      (await claimUnreadableFromThisFloor(
        { assemblyLineId, nodeId, iteration, agentName },
        deps,
      ));

    if (leftToReaper) {
      return;
    }
    // Unwrap the NDJSON envelope once, here: every text parser below (the outcome
    // precedence and the review findings alike) must read the agent text, not the
    // stream that carries it.
    const rawStatus = reported ??
      (await deps.readAgentStatus(agentName)) ?? {
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
    // failure notice, which only ever carries a routing reason. A missing-settings
    // failure (an unreachable skills_source) is the same shape of outage on a
    // different axis — every Claude-agent node on the affected CLUSTER, not the
    // account — so it gets the same treatment.
    if (result.outcome === "failed" && deps.alertBilling) {
      await deps.alertBilling(row.repo, node.type, status);
    }

    if (result.outcome === "failed" && deps.alertAgentConfig) {
      await deps.alertAgentConfig(row.repo, node.type, status);
    }
    tripGateOnAccountOutage(result, deps);

    await finishNodeTerminal(
      { row, node, nodeId, iteration, result, output: status.output },
      deps,
    );
  };
}

/** True when the terminal CR was claimed by a cluster this Floor cannot read —
 *  the node stays open for the cluster-aware reaper, which waits the node's
 *  budget, requeues if the claimant dies, and times out honestly if it does
 *  not. Nothing is fabricated from an output nobody read. */
async function claimUnreadableFromThisFloor(
  params: {
    assemblyLineId: string;
    nodeId: string;
    iteration: number | undefined;
    agentName: string;
  },
  deps: NodeEventDeps,
): Promise<boolean> {
  const { assemblyLineId, nodeId, iteration, agentName } = params;
  const openRow = (
    await deps.assemblyRuns.listStationRuns(assemblyLineId)
  ).find(
    (row) =>
      row.nodeId === nodeId &&
      row.outcome === null &&
      (iteration === undefined || row.iteration === iteration),
  );
  const centralClusterAgentId = (await deps.centralClusterAgentId?.()) ?? null;

  if (!openRow || agentCrVisible(openRow, centralClusterAgentId)) {
    return false;
  }
  console.warn(
    `[assembly-run] ${assemblyLineId} node ${nodeId}: terminal status unreadable — ` +
      `the Agent CR ${agentName} was claimed by cluster ${openRow.clusterAgentId ?? "(none)"}, ` +
      `which this Floor cannot read; leaving the node open for the reaper`,
  );

  return true;
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
  node: { type: string; prompt_ref?: string | null },
  rawStatus: AgentNodeStatus,
  deps: Pick<AdvanceDeps, "assemblyRuns"> &
    Pick<NodeEventDeps, "deliveredChangeCount">,
): Promise<NodeResult> {
  const { args, missing } = artifactsFromTerminalOutput(rawStatus.output);

  if (Object.keys(args).length > 0) {
    await deps.assemblyRuns.mergeArgs(row.id, args);
  }
  const result = stationNodeOutcome(node, normalizeAgentStatus(rawStatus));

  if (result.outcome === "failed") {
    return result;
  }

  if (missing.length > 0) {
    return undelivered(`declared artifact not produced: ${missing.join(", ")}`);
  }

  // A node whose job was to CHANGE THE BRANCH and left it empty is not a
  // success, whatever it printed. Decided here, right after the node, rather
  // than two nodes later at push: the next node is another pod with a fresh
  // clone, so validate would diff an empty branch and lint the whole tree for
  // nothing (18 of 18 implementation-loop branches, 2026-08-30). Retryable —
  // an agent that forgot to push is exactly what the self-retry edge is for.
  return (await emptyDeliveryFailure(row, node, deps)) ?? result;
}

async function emptyDeliveryFailure(
  row: AssemblyRunRecord,
  node: { type: string; prompt_ref?: string | null },
  deps: Pick<NodeEventDeps, "deliveredChangeCount">,
): Promise<NodeResult | null> {
  if (
    !isDeliveringRecipe(node.prompt_ref) ||
    !deps.deliveredChangeCount ||
    !row.branch
  ) {
    return null;
  }
  const changed = await deps.deliveredChangeCount(row.repo, row.branch);

  if (changed !== 0) {
    return null;
  }

  return undelivered(
    `the ${node.prompt_ref} node reported success but pushed nothing — ${row.branch} has no changes against the default branch`,
  );
}

const undelivered = (detail: string): NodeResult => ({
  outcome: "failed",
  failureClass: "unknown",
  failureDetail: detail,
  extras: { "Lore-Validation-Summary": detail },
});

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
  node: RunGraphNode,
  result: NodeResult,
): Promise<void> {
  // Keyed on the node's TYPE, which is what `comment-triage` actually IS —
  // `NodeType` has carried that variant since the loader learned about it. The
  // old test compared the definition NAME and the node ID as strings, so
  // renaming the node in comment-triage.yaml, or reusing a triage node on
  // another definition, left `extras.action` unread: the walk finished green
  // and the human's comment was silently never routed.
  if (node.type !== "comment-triage") {
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
    // The commenter rides along: the triage line stored who wrote the comment,
    // and the line triage ROUTES TO is the one a person will look at in the run
    // list. Dropping it here left "By" blank on exactly the runs a human asked
    // for, while the keyword fast path — same destination — kept it.
    actor: typeof a.actor === "string" ? a.actor : undefined,
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
    { readyPrBody, stampLinePr },
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
    // Per-repo override CRDs live under project-qualified names; the dispatch
    // must spell its stationRef the way the catalog sync applied it.
    qualifyStationRef: async (baseRef, repo) => {
      const [{ qualifiedStationRef }, { getPool }] = await Promise.all([
        import("@re-cinq/lore-shared/project/agents/agent-defs-pg.js"),
        import("@re-cinq/lore-shared/db/pg-pool.js"),
      ]);

      return qualifiedStationRef(getPool(), baseRef, repo);
    },
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
    markPrReady: async (row, result) => {
      const project = await projectFor(row.repo);
      // Narrowed rather than cast: decideMarkReady already required a numeric
      // pr_number before this fires, and a cast would outlive that guarantee.
      const number = row.args.pr_number;

      if (typeof number !== "number") {
        return;
      }
      // The description the pr-ready node produced (a declared artifact merged
      // into args before the walk advanced) plus the footer the draft carried —
      // rewriting with the prose alone destroyed the Closes/Lore-Task footer.
      // The node's extras carry the coverage verdict that picks Closes vs Refs.
      // Null means the node wrote no prose, and the PR keeps its old body.
      const body = readyPrBody(row, result.extras);

      if (body !== null) {
        await project.pulls.update(number, { body });
      }
      await project.pulls.markReady(number);
    },
    readAgentStatus: (name) => cluster.getStatus(name),
    // The same compare the watcher uses for a single-CR task, applied to a
    // node: an implement that pushed nothing is not done.
    deliveredChangeCount: async (repo, branch) => {
      const project = await projectFor(repo);

      return project.pulls.changedFileCount(
        await project.repo.defaultBranch(),
        branch,
      );
    },
    llmGate: llmDispatchGate,
    alertBilling: async (repo, nodeType, status) => {
      await maybeAlertBilling(repo, nodeType, status, {
        notify: async (level, message) =>
          (await projectFor(repo)).notify.notify(level, message),
        throttle: billingAlertThrottle,
      });
    },
    alertAgentConfig: async (repo, nodeType, status) => {
      await maybeAlertAgentConfig(repo, nodeType, status, {
        notify: async (level, message) =>
          (await projectFor(repo)).notify.notify(level, message),
        throttle: agentConfigAlertThrottle,
      });
    },
  };
}

/** Module singleton: the billing outage is account-wide, so the alert throttle
 *  must survive across per-event deps (one alert/hour across all repos). */
const billingAlertThrottle = new BillingAlertThrottle();

/** Module singleton, same reasoning: a misconfigured skills_source strands
 *  every Claude-agent node a cluster claims, not just one repo's run. */
const agentConfigAlertThrottle = new BillingAlertThrottle();

/** Composed production handler for the registry (both node-terminal events). */
export const agentNodeTerminal: EventHandler = async (params) => {
  const handler = createNodeEventHandler(await productionNodeEventDeps());

  return handler(params);
};
