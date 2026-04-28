import type { NodeHandler, NodeHandlers } from "./graph-executor.js";
import { writeEpisode, writeEpisodeWithCuration } from "../lib/episode-writer.js";

export interface ProductionHandlersDeps {
  /** Override for testing — defaults to the real episode-writer. */
  writeEpisode?: typeof writeEpisode;
  /** Override for testing — defaults to the curating variant. */
  writeEpisodeWithCuration?: typeof writeEpisodeWithCuration;
  /**
   * Whether to call the curation step (Haiku lesson extraction) in
   * addition to writing the episode. Defaults to true; tests turn it
   * off to avoid hitting Anthropic.
   */
  curate?: boolean;
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
  deps: ProductionHandlersDeps = {},
): NodeHandler {
  const writer = deps.writeEpisode ?? writeEpisode;
  const curator = deps.writeEpisodeWithCuration ?? writeEpisodeWithCuration;
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
  episodeDeps?: ProductionHandlersDeps;
}): NodeHandlers {
  return {
    agent: opts.agent,
    // Validate handler defaults to a no-op success — the real
    // lint/typecheck integration lives in mcp-server/src/repo-validation
    // and is invoked by the GKE Job pod's entrypoint.sh today. Wiring
    // it into this codepath happens when the supervisor integrates with
    // executeGraph in production (see T058 follow-up).
    validate: opts.validate ?? (async () => ({ outcome: "success" })),
    gate: opts.gate ?? (async () => ({ outcome: "success" })),
    retrospective:
      opts.retrospective ??
      createProductionRetrospectiveHandler(opts.episodeDeps),
  };
}
