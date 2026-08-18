// Recovering a planning round's GapResult from the run transcript.
//
// The pod delivers its result twice-removed from the round row: a `kind:"file"`
// artifact event (or its own POST) reaches `applyGapResult`, which closes the
// iteration. Both deliveries ride infrastructure that can drop them — 2026-08-18
// (#1298) a controller churn window ate the artifact event AND got the round
// reaped, leaving the author a blank wizard while the finished result sat in
// `pipeline.agent_run_turns`. The transcript is durable (#1148), so the reaper
// can re-derive the payload from the agent's terminal Write instead of asking a
// human to re-run the round.

interface TurnEnvelope {
  event?: {
    type?: string;
    message?: { role?: string; content?: unknown };
  };
}

interface ToolUseBlock {
  type?: string;
  name?: string;
  input?: { file_path?: unknown; content?: unknown };
}

/**
 * The last artifact the agent wrote at `artifactSuffix`, parsed — or null when
 * the transcript holds none (an agent that genuinely failed never wrote one).
 *
 * Scans newest-first: a self-correcting agent may write the file more than once
 * and the final version is the one the watch would have shipped. A Write whose
 * content is not valid JSON is skipped rather than fatal — an earlier good write
 * may still satisfy the recovery.
 */
export function gapResultFromTurns(
  envelopes: readonly unknown[],
  artifactSuffix: string,
): unknown | null {
  for (let i = envelopes.length - 1; i >= 0; i--) {
    const event = (envelopes[i] as TurnEnvelope)?.event;

    if (event?.type !== "assistant") {
      continue;
    }
    const content = event.message?.content;

    if (!Array.isArray(content)) {
      continue;
    }

    // Blocks scan newest-first too: one message can carry several Writes and
    // the LAST one is the version the watch would have shipped.
    const blocks = content as ToolUseBlock[];

    for (let b = blocks.length - 1; b >= 0; b--) {
      const block = blocks[b];

      if (block?.type !== "tool_use" || block.name !== "Write") {
        continue;
      }
      const path = block.input?.file_path;
      const body = block.input?.content;

      if (
        typeof path !== "string" ||
        !path.endsWith(artifactSuffix) ||
        typeof body !== "string"
      ) {
        continue;
      }

      try {
        return JSON.parse(body);
      } catch {
        continue;
      }
    }
  }

  return null;
}
