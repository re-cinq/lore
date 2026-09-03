// Layer-3 handler for `kubernetes.agent_node.{succeeded,failed}` (FR6): parse outcome, record (CAS), advance the line. Since FR4's follow-up the event may already carry the CR's status (`params.status`, from cluster-agent); only an older cluster-agent's event falls through to the central read + reaper handoff.

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
import { rottenAnchorReport } from "./spec-anchor-check.js";
import type { RottenAnchorReportInput } from "./spec-anchor-check.js";
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
  /** Null means pruned OR unreachable-cluster — two different facts wearing the same null; {@link agentCrVisible} tells them apart. */
  readAgentStatus: (name: string) => Promise<AgentNodeStatus | null>;
  /** How much a DELIVERING node's branch differs from default; zero turns reported success into a failure. Optional seam — absent trusts the node's own word (pre-2026-08-30 behaviour). */
  deliveredChangeCount?: (repo: string, branch: string) => Promise<number>;
  /** The central cluster's registered agent id, resolved per call (minted at registration). Omitted/null leaves only legacy `running` rows visible (pre-claim-path behaviour). */
  centralClusterAgentId?: () => Promise<string | null>;
  /** Throttled operator alert when a CR failed because the Anthropic account ran dry; best-effort, optional. */
  alertBilling?: (
    repo: string,
    nodeType: string,
    status: AgentNodeStatus,
  ) => Promise<void>;
  /** Throttled operator alert when an AgentDefinition's skills_source was unreachable, stranding every Claude-agent node the affected cluster claims; best-effort, optional. */
  alertAgentConfig?: (
    repo: string,
    nodeType: string,
    status: AgentNodeStatus,
  ) => Promise<void>;
}

/** The event's own reported status (FR4's follow-up), or null when an older cluster-agent sent none; narrowed defensively since `params` is untyped JSONB off the wire. */
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
    const event = readNodeEvent(params);
    const target = await resolveEventTarget(event, deps);

    if (!target) {
      return;
    }
    const reported = reportedStatus(params.status);

    // Only an older cluster-agent's event (no status) needs a cluster interrogated; an unreachable CR would otherwise read as "agent produced nothing" (2026-08-27 regression). Hand off to the cluster-aware reaper instead of fabricating an outcome.
    const leftToReaper =
      reported === null && (await claimUnreadableFromThisFloor(event, deps));

    if (leftToReaper) {
      return;
    }
    // Unwrap the NDJSON envelope once: every text parser below must read the agent text, not the stream carrying it.
    const rawStatus = reported ??
      (await deps.readAgentStatus(event.agentName)) ?? {
        phase: String(params.phase ?? ""),
      };
    const status = normalizeAgentStatus(rawStatus);
    // Merged BEFORE the walk moves — the artifact sink is a separate racing HTTP post, so without this the next station could miss an arg its predecessor already produced (a re-merge is a no-op).
    const result = await deliverTerminalArtifacts(
      target.row,
      target.node,
      rawStatus,
      deps,
    );

    await alertOnFailure(target, result, status, deps);
    tripGateOnAccountOutage(result, deps);

    await finishNodeTerminal(
      {
        row: target.row,
        node: target.node,
        nodeId: event.nodeId,
        iteration: event.iteration,
        result,
        output: status.output,
      },
      deps,
    );
  };
}

/** The three ids every agent_node event must carry, plus which visit it reports. */
interface NodeEvent {
  assemblyLineId: string;
  nodeId: string;
  agentName: string;
  iteration: number | undefined;
}

function readNodeEvent(params: Record<string, unknown>): NodeEvent {
  // A JSON null is as absent as a missing key: stringifying it would produce the literal "null" and pass the emptiness check below.
  const text = (value: unknown): string =>
    value === undefined || value === null ? "" : String(value);
  const event = {
    assemblyLineId: text(params.assemblyRunId) || text(params.assemblyLineId),
    nodeId: text(params.nodeId),
    agentName: text(params.agentName),
    iteration:
      typeof params.iteration === "number" ? params.iteration : undefined,
  };

  enforceTrue(
    event.assemblyLineId.length > 0 &&
      event.nodeId.length > 0 &&
      event.agentName.length > 0,
    Error,
    "kubernetes.agent_node event params missing assemblyLineId/nodeId/agentName",
  );

  return event;
}

/** The run and node the event is about, or null when there is nothing to advance — the run is gone or finished, or its graph no longer has that node. */
async function resolveEventTarget(
  event: NodeEvent,
  deps: NodeEventDeps,
): Promise<{ row: AssemblyRunRecord; node: RunGraphNode } | null> {
  const row = await deps.assemblyRuns.getById(event.assemblyLineId);

  if (!row || row.status !== "running") {
    return null;
  }
  const graph = await resolveRunGraph(row, deps.definitions);
  const node = graph?.nodes.find((n) => n.id === event.nodeId);

  return node ? { row, node } : null;
}

/** An account-out-of-credits failure downs every LLM node at once, and a missing skills_source strands every Claude-agent node on the CLUSTER — both are surfaced once to operators, ahead of the per-line failure notice. */
async function alertOnFailure(
  target: { row: AssemblyRunRecord; node: RunGraphNode },
  result: { outcome: string },
  status: ReturnType<typeof normalizeAgentStatus>,
  deps: NodeEventDeps,
): Promise<void> {
  if (result.outcome !== "failed") {
    return;
  }

  if (deps.alertBilling) {
    await deps.alertBilling(target.row.repo, target.node.type, status);
  }

  if (deps.alertAgentConfig) {
    await deps.alertAgentConfig(target.row.repo, target.node.type, status);
  }
}

/** True when the terminal CR was claimed by a cluster this Floor cannot read — the node stays open for the cluster-aware reaper rather than fabricating an outcome. */
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

/** Merges declared artifacts then decides outcome; shared by both terminal doors (node event + reaper resolve) since a dropped event means only one will ever see this output. A declared-but-unproduced artifact FAILS the node — else the next station reads an empty bag as "predecessor decided nothing." */
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

  // A DELIVERING node that left the branch empty is not a success, whatever it printed — caught here rather than at push, since the next pod's fresh-clone validate would otherwise lint the whole tree for nothing (18/18 impl-loop branches, 2026-08-30). Retryable via the self-retry edge.
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

/** Stops dispatching agent nodes when this failure says the account (not the run) is down; logged only on the transition, so an outage produces one event, not one per drowned run. */
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

/** Reads a terminal comment-triage node's classified action and starts the routed follow-up line; best-effort, never fails the walk. */
async function routeCommentTriage(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  result: NodeResult,
): Promise<void> {
  // Keyed on the node's TYPE, not definition name/node id (the old comparison silently left comment-triage nodes unrouted on rename or reuse).
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
    // Dropping this left "By" blank on runs a human asked for; the keyword fast path (same destination) kept it.
    actor: typeof a.actor === "string" ? a.actor : undefined,
  };
}

/** Re-exported for the start handler / reaper compositions. */
export { advanceLine };

/** Resolved lazily so importing the registry never forces the DB pool or K8s client; shared by the node-event handler, the start handler's advance, and the reaper tick. */
/** Deterministic paperwork check (#1747): anchors in this branch's changed markdown must land on citable lines. Best-effort — a rotten link is a comment for the reviewer, never a failed flip. */
async function reportRottenAnchors(
  prNumber: number,
  branch: string | null | undefined,
  project: Pick<RottenAnchorReportInput, "pulls" | "repo"> & {
    issues: { comment(issueNumber: number, body: string): Promise<unknown> };
  },
): Promise<void> {
  if (!branch) {
    return;
  }

  try {
    const report = await rottenAnchorReport({
      prNumber,
      branch,
      pulls: project.pulls,
      repo: project.repo,
    });

    if (report) {
      await project.issues.comment(prNumber, report);
    }
  } catch (err) {
    console.warn(
      `[spec-anchor-check] PR #${prNumber}: ${(err as Error).message}`,
    );
  }
}

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
    { readyPrBody, readyPrTitle, stampLinePr },
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
    // Wired HERE so it reaches every door (CR event, reaper resolve, `assembly_run.resume`) — it used to be CR-handler-only, so a REAPER-resolved triage node silently never routed.
    onNodeFinished: routeCommentTriage,
    // Enqueue-time half of FR2: `resolveRequiredTags` reads `station_default_tags` from this raw settings object.
    repoSettings: (repo) => settings().rawSettings(repo),
    // Per-repo override CRDs live under project-qualified names; dispatch must spell its stationRef as the catalog sync applied it.
    qualifyStationRef: async (baseRef, repo) => {
      const [{ qualifiedStationRef }, { getPool }] = await Promise.all([
        import("@re-cinq/lore-shared/project/agents/agent-defs-pg.js"),
        import("@re-cinq/lore-shared/db/pg-pool.js"),
      ]);

      return qualifiedStationRef(getPool(), baseRef, repo);
    },
    // Strict: an unknown prompt_ref fails the node instead of silently running `general` (#1329).
    resolvePrompt: buildNodePrompt,
    cleanupToken: cleanupPerTaskToken,
    jobRuns: pipeline().jobRuns,
    notifyFailure: notifyLineFailure,
    onRunClosed: async (run, outcome, reason) => {
      const { loopRunClosed } = await import("../backlog/loop-run-closed.js");

      await loopRunClosed(run, outcome, reason);
    },
    // Publishes a service-form node for the pooled stations service to claim, instead of a pod per DB write/HTTP POST.
    publishNode: (event) =>
      eventReporter().insert({ ...event, source: "internal" }),
    // What the retrospective station was for and never did (every blueprint names it as EXIT, so the walk never dispatches it).
    recordRunEpisode: async (run, outcome, reason) => {
      const { writeEpisode } = await import("@re-cinq/lore-shared");

      await writeEpisode(
        { memory: memoryLifecycle() },
        {
          content: [
            `Assembly run ${run.blueprintName} on ${run.repo} ${outcome}.`,
            `Branch: ${run.branch ?? "(none)"}`,
            reason ? `Reason: ${reason}` : "",
          ]
            .filter((l) => l.length > 0)
            .join("\n"),
          source: "assembly-run",
          ref: `${run.repo}/${run.id}`,
        },
      );
    },
    resolveConversation: (node, task, iteration, priorOutcome) =>
      resolveConversation(
        node,
        task,
        { iteration, priorOutcome },
        {
          conversations: conversations(),
          // The URL the POD must reach — the same sink host it already posts telemetry to, not the Floor's own view of itself.
          registryUrl: `${process.env.LORE_FLOOR_POD_URL ?? ""}/api/agent-conversations`,
          headersSecret: "agent-events-auth",
          // `args.resume_from_task` names the round the author chose; its reserved conversation is keyed by the assembly line that ran it.
          linesForTask: async (taskId) =>
            (await pipeline().assemblyRuns.listForTask(taskId)).map(
              (line) => line.id,
            ),
        },
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
      // Narrowed rather than cast: decideMarkReady already required a numeric pr_number before this fires.
      const number = row.args.pr_number;

      if (typeof number !== "number") {
        return;
      }
      // readyPrBody rebuilds the Closes/Lore-Task footer (rewriting with prose alone destroyed it); null means no prose was produced, so the PR keeps its old body.
      const body = readyPrBody(row, result.extras);
      // The draft opened under the TICKET's title, written before any code
      // existed. The pr-ready node has read the finished branch, so it renames
      // the PR after the work; a node that reported no title leaves the
      // ticket title standing rather than blanking it.
      const title = readyPrTitle(result.extras);

      if (body !== null || title !== null) {
        await project.pulls.update(number, {
          ...(body !== null ? { body } : {}),
          ...(title !== null ? { title } : {}),
        });
      }
      await project.pulls.markReady(number);

      await reportRottenAnchors(number, row.branch, project);
    },
    readAgentStatus: (name) => cluster.getStatus(name),
    // Same compare the watcher uses for a single-CR task: an implement that pushed nothing is not done.
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

/** Module singleton: the billing outage is account-wide, so the throttle must survive across per-event deps (one alert/hour across all repos). */
const billingAlertThrottle = new BillingAlertThrottle();

/** Module singleton, same reasoning — a misconfigured skills_source strands every node a cluster claims, not just one repo. */
const agentConfigAlertThrottle = new BillingAlertThrottle();

/** Composed production handler for the registry (both node-terminal events). */
export const agentNodeTerminal: EventHandler = async (params) => {
  const handler = createNodeEventHandler(await productionNodeEventDeps());

  return handler(params);
};
