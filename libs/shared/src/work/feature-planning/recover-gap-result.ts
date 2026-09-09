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

/** The assistant message's tool-use blocks, or null when this envelope isn't an assistant turn with block content. */
function assistantContentBlocks(envelope: unknown): ToolUseBlock[] | null {
  const event = (envelope as TurnEnvelope | null | undefined)?.event;

  if (event?.type !== "assistant") {
    return null;
  }
  const content = event.message?.content;

  return Array.isArray(content) ? (content as ToolUseBlock[]) : null;
}

/** The last artifact written at `artifactSuffix`, parsed, or null when none exists; scans newest-first (a self-correcting agent may rewrite it) and skips a non-JSON Write rather than failing. */
export function gapResultFromTurns(
  envelopes: readonly unknown[],
  artifactSuffix: string,
): unknown | null {
  for (let i = envelopes.length - 1; i >= 0; i--) {
    const blocks = assistantContentBlocks(envelopes[i]);

    if (!blocks) {
      continue;
    }
    const artifact = lastArtifactWrite(blocks, artifactSuffix);

    if (artifact) {
      return artifact.value;
    }
  }

  return null;
}

interface ArtifactWrite {
  body: string;
}

function isWriteBlock(block: ToolUseBlock | undefined): block is ToolUseBlock {
  return block?.type === "tool_use" && block.name === "Write";
}

function matchesArtifactPath(
  block: ToolUseBlock,
  artifactSuffix: string,
): boolean {
  const path = block.input?.file_path;

  return typeof path === "string" && path.endsWith(artifactSuffix);
}

/** The block's Write target/body when it writes to `artifactSuffix`, else null. */
function artifactWriteOf(
  block: ToolUseBlock | undefined,
  artifactSuffix: string,
): ArtifactWrite | null {
  if (!isWriteBlock(block) || !matchesArtifactPath(block, artifactSuffix)) {
    return null;
  }
  const body = block.input?.content;

  return typeof body === "string" ? { body } : null;
}

function parseArtifactBody(body: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(body) };
  } catch {
    return null;
  }
}

/** The last parseable Write to `artifactSuffix` among one message's blocks, scanned newest-first since the LAST Write is the version the watch would have shipped. */
function lastArtifactWrite(
  blocks: ToolUseBlock[],
  artifactSuffix: string,
): { value: unknown } | null {
  for (let b = blocks.length - 1; b >= 0; b--) {
    const write = artifactWriteOf(blocks[b], artifactSuffix);
    const parsed = write ? parseArtifactBody(write.body) : null;

    if (parsed) {
      return parsed;
    }
  }

  return null;
}
