import {
  unconfiguredError,
  deniedError,
  type ProxyResult,
  textResult,
} from "../../shared/deps.js";

// Usage + analytics read from pipeline.tasks/pipeline.llm_calls, reachable only by the remote API (no local pool, ADR-032); both tools just proxy and pretty-print.

/** Pretty-print a proxied JSON body, or map the failure to tool text. */
export function renderProxied(
  proxied: ProxyResult,
  { op, subject, toolName }: { op: string; subject: string; toolName: string },
): { content: [{ type: "text"; text: string }] } {
  if (proxied.ok) {
    return textResult(JSON.stringify(JSON.parse(proxied.body), null, 2));
  }

  if (proxied.reason === "not_configured") {
    return unconfiguredError(op);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  // A read with no local fallback: surface the server's reason plainly rather than the write-oriented "refusing local-file fallback" copy.
  return textResult(
    `Could not fetch ${subject} from the Lore API: ${proxied.detail}`,
  );
}
