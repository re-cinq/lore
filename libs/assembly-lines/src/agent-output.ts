// The station contract's output envelope (ADR-031 D8/D9). An Agent's
// `status.output` is an NDJSON event stream whose terminal line is the
// claude-style `{"type":"result","is_error":false,"result":"<agent text>"}`
// (written by `apps/lore-station/src/output.ts`). The agent text rides inside a
// JSON string field, so its newlines arrive escaped and any fenced block or
// embedded JSON is backslash-escaped with it.
//
// Unwrap here, once, at the read boundary — then the text parsers
// (parseNodeResult / parseReviewVerdict / parseReviewFindings) stay pure and see
// the agent text exactly as the agent printed it. Parsers that scan for a
// single-line marker survive the escaping by luck; anything needing a real
// newline (the ```REVIEW_FINDINGS block) does not.

interface ResultLine {
  type: string;
  result?: unknown;
}

function parseLine(line: string): ResultLine | null {
  try {
    const value: unknown = JSON.parse(line);

    return isResultLine(value) ? value : null;
  } catch {
    return null;
  }
}

function isResultLine(value: unknown): value is ResultLine {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ResultLine).type === "result"
  );
}

/**
 * The agent text carried by the last terminal result line of an NDJSON stream.
 * Falls back to the raw input when the output is not an NDJSON stream, carries
 * no result line, or the result line has no string payload — legacy and
 * already-unwrapped output must pass through untouched.
 */
export function resultTextFromOutput(output: string): string {
  const lines = output.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseLine(lines[i].trim());

    if (parsed && typeof parsed.result === "string") {
      return parsed.result;
    }
  }

  return output;
}
