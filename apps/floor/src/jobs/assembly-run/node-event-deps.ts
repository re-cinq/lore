// The production dependency wiring for NodeEventDeps: composes the real assembly-runs, prompt, PR, and alert adapters, plus the comment-triage router and rotten-anchor check both terminal doors share.

import { HttpAgentApi } from "@re-cinq/lore-shared";
import { clusterAgent } from "../../kernel/queues.js";
import { notifyLineFailure } from "./notify-failure.js";
import { rottenAnchorReport } from "./spec-anchor-check.js";
import type { RottenAnchorReportInput } from "./spec-anchor-check.js";
import { BillingAlertThrottle, maybeAlertBilling } from "./billing-alert.js";
import { maybeAlertAgentConfig } from "./agent-config-alert.js";
import { llmDispatchGate } from "./llm-dispatch-gate.js";
import {
  codeReviewOnCommentTriaged,
  type CommentContext,
} from "../review/code-review.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { NodeEventDeps } from "./node-event-handler.js";

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

const numberArg = (value: unknown): number => Number(value) || 0;

const stringArgOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const numberArgOrNull = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

function contextFromRow(row: AssemblyRunRecord): CommentContext {
  const a = row.args;

  return {
    repo: row.repo,
    pr_number: numberArg(a.pr_number),
    branch: row.branch ?? "",
    head_sha: stringArgOrUndefined(a.head_sha),
    comment_id: numberArg(a.comment_id),
    comment_body: String(a.comment_body ?? ""),
    in_reply_to_id: numberArgOrNull(a.in_reply_to_id),
    // Dropping this left "By" blank on runs a human asked for; the keyword fast path (same destination) kept it.
    actor: stringArgOrUndefined(a.actor),
  };
}

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

/** Module singleton: the billing outage is account-wide, so the throttle must survive across per-event deps (one alert/hour across all repos). */
const billingAlertThrottle = new BillingAlertThrottle();

/** Module singleton, same reasoning — a misconfigured skills_source strands every node a cluster claims, not just one repo. */
const agentConfigAlertThrottle = new BillingAlertThrottle();

// eslint-disable-next-line max-lines-per-function -- composition root: one line per injected dependency, so its length IS the dependency count.
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
      // PR title updated by pr-ready node after code finishes; null keeps ticket title.
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
