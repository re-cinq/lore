// Recovering a planning round's GapResult from the run transcript: both the artifact event and the pod's POST can be dropped (#1298 controller-churn ate one and reaped the round), so the durable transcript (#1148) re-derives the payload from the agent's terminal Write.

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

/** The last artifact written at `artifactSuffix`, parsed, or null when none exists; scans newest-first (a self-correcting agent may rewrite it) and skips a non-JSON Write rather than failing. */
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
    const artifact = lastArtifactWrite(
      content as ToolUseBlock[],
      artifactSuffix,
    );

    if (artifact) {
      return artifact.value;
    }
  }

  return null;
}

/** The last parseable Write to `artifactSuffix` among one message's blocks, scanned newest-first since the LAST Write is the version the watch would have shipped. */
function lastArtifactWrite(
  blocks: ToolUseBlock[],
  artifactSuffix: string,
): { value: unknown } | null {
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
      return { value: JSON.parse(body) };
    } catch {
      continue;
    }
  }

  return null;
}
