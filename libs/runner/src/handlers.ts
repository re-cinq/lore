import type { NodeHandler, NodeHandlers } from "./graph-executor.js";

/** Writes one `memory.episodes` row. Injected by the agent bootstrap. */
export type WriteEpisode = (
  content: string,
  source: string,
  ref: string,
  agentId: string,
) => Promise<unknown>;

/** Writes an episode + an auto-curated lesson. Injected by the agent bootstrap. */
export type WriteEpisodeWithCuration = (
  summary: string,
  phase: string,
  ref: string,
  agentId: string,
  taskId: string,
) => Promise<void>;

/**
 * An auto-merge candidate at retrospective time. `policy` is opaque to the
 * kernel — it is resolved by the agent and handed straight back to
 * {@link ProductionHandlersDeps.evaluateAndMerge}.
 */
export interface AutoMergeCandidate {
  repo: string;
  prNumber: number;
  policy: unknown;
}

export interface ProductionHandlersDeps {
  /** Episode writer — required (the kernel cannot reach the agent's DB directly). */
  writeEpisode: WriteEpisode;
  /** Curating episode writer (Haiku lesson extraction). */
  writeEpisodeWithCuration: WriteEpisodeWithCuration;
  /**
   * Whether to call the curation step in addition to writing the episode.
   * Defaults to true; the pod path turns it off to avoid the Haiku call.
   */
  curate?: boolean;
  /**
   * Optional auto-merge trigger. When provided AND a PR is associated with
   * the task at retrospective time, the retrospective handler calls it after
   * writing the episode. The agent backs this with the real auto-merge engine.
   */
  evaluateAndMerge?: (
    inputs: { taskId: string } & AutoMergeCandidate,
  ) => Promise<{ outcome: string }>;
  /**
   * Lookup the PR associated with the current task at retrospective time.
   * Returns null when no PR exists yet. The agent wires this to its
   * pipeline.tasks query.
   */
  resolvePrForTask?: (taskId: string) => Promise<AutoMergeCandidate | null>;
}

/**
 * Production retrospective handler. Closes FR1's loop: every workflow
 * ends with an episode capturing what happened on the branch, and an
 * auto-curated lesson stored as `auto-curation/<task-id>` for future
 * tasks to retrieve.
 *
 * Side effects:
 *  - Writes one row to `memory.episodes`.
 *  - When curate=true (default): may write one row to `memory.memories`
 *    via the existing auto-curation pipeline.
 *
 * Dedup: `writeEpisode` hashes content and ON CONFLICT DO NOTHING, so
 * a re-run resume that re-executes the retrospective node is safe.
 */
export function createProductionRetrospectiveHandler(
  deps: ProductionHandlersDeps,
): NodeHandler {
  const writer = deps.writeEpisode;
  const curator = deps.writeEpisodeWithCuration;
  const curate = deps.curate ?? true;

  return async (_node, ctx) => {
    const summary =
      `Task ${ctx.taskId} completed workflow ${ctx.workflowName} ` +
      `on branch ${ctx.branchName} (iteration ${ctx.iteration}).`;
    const ref = `dark-factory/${ctx.taskId}`;

    if (curate) {
      await curator(summary, "retrospective", ref, "supervisor", ctx.taskId);
    } else {
      await writer(summary, "retrospective", ref, "supervisor");
    }

    // Auto-merge trigger. The retrospective node is the right place
    // because the workflow has finished its real work — the PR is open,
    // CI is running (or done), bot review has posted. Calling
    // evaluateAndMerge here keeps the auto-merge decision atomic with
    // the workflow exit; no separate poll/webhook needed.
    const triggerAutoMerge = deps.evaluateAndMerge;
    const resolvePrForTask = deps.resolvePrForTask;
    if (triggerAutoMerge && resolvePrForTask) {
      try {
        const pr = await resolvePrForTask(ctx.taskId);
        if (pr) {
          await triggerAutoMerge({
            taskId: ctx.taskId,
            repo: pr.repo,
            prNumber: pr.prNumber,
            policy: pr.policy,
          });
        }
      } catch (err) {
        console.warn(
          "[retrospective] auto-merge trigger failed:",
          (err as Error).message,
        );
      }
    }

    return { outcome: "success" };
  };
}

/**
 * Compose a full handler set for production use. Caller must supply
 * the `agent` handler (LLM dispatch is task-specific) and may
 * optionally override any other handler.
 */
export function createProductionHandlers(opts: {
  agent: NodeHandler;
  validate?: NodeHandler;
  gate?: NodeHandler;
  retrospective?: NodeHandler;
  episodeDeps: ProductionHandlersDeps;
}): NodeHandlers {
  return {
    agent: opts.agent,
    // Validate handler defaults to a no-op success — the deterministic
    // lint/typecheck integration (repo-validation) is invoked by the GKE
    // Job pod's entrypoint.sh today; wiring it into the graph is a follow-up.
    validate: opts.validate ?? (async () => ({ outcome: "success" })),
    gate: opts.gate ?? (async () => ({ outcome: "success" })),
    retrospective:
      opts.retrospective ??
      createProductionRetrospectiveHandler(opts.episodeDeps),
  };
}
