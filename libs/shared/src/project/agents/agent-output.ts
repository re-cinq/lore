/**
 * The `output` block of an AgentDefinition recipe (ADR-030): how a run's
 * STRUCTURED answer leaves the Agent (code-edit work product stays branch-as-state).
 * The runner owns the fan-out, so it is tool-agnostic: every AgentTool adapter
 * parses its native stream into the normalized `AgentEvent` model below, the
 * recipe's `select` filters it, and `sinks` route the result.
 */

export type OutputFormat = "text" | "json" | "stream-json";

/** A normalized event emitted by any AgentTool adapter, regardless of native format. */
export type AgentEventKind = "tool_call" | "message" | "tool_result" | "result" | "usage";

export interface AgentEvent {
  kind: AgentEventKind;
  /** For tool_call/tool_result: the tool name (e.g. "Bash"). */
  tool?: string;
  /** For message: the speaker. */
  role?: "assistant" | "user";
  /** Text payload (message text, result body, tool output). */
  text?: string;
  /** Structured payload (tool input, parsed result, usage numbers). */
  data?: unknown;
}

/** A selector over the AgentEvent stream — WHAT to emit. Omitting select = the final result only. */
export interface OutputSelector {
  event: AgentEventKind;
  /** Match a specific tool (tool_call / tool_result). */
  tool?: string;
  /** Match a speaker (message). */
  role?: "assistant" | "user";
  /** Match events whose `text` contains this substring. */
  contains?: string;
}

export type OutputSinkType = "stdout" | "http" | "file";

/** A destination for selected events. `http.url` is allowlist-checked. */
export interface OutputSink {
  type: OutputSinkType;
  /** http: the endpoint to POST to. */
  url?: string;
  /** http: secret ref resolved to the Authorization header. */
  headers_secret?: string;
  /** file: the path to write (may reference $LORE_RESULT_PATH). */
  path?: string;
}

export interface AgentOutput {
  format?: OutputFormat;
  /** Optional JSON Schema the collected result is validated against. */
  schema?: Record<string, unknown>;
  select?: OutputSelector[];
  sinks?: OutputSink[];
}
