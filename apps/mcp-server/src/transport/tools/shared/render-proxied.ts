import {
  unconfiguredError,
  deniedError,
  type ProxyResult,
  textResult,
} from "./deps.js";

// A read with no local fallback (no pool, ADR-032): proxy, then pretty-print the body or name the failure.

export interface ProxiedRead {
  op: string;
  subject: string;
  toolName: string;
}

/** Pretty-print a proxied JSON body, or map the failure to tool text. */
export function renderProxied(
  proxied: ProxyResult,
  read: ProxiedRead,
): { content: [{ type: "text"; text: string }] } {
  return proxied.ok
    ? textResult(JSON.stringify(JSON.parse(proxied.body), null, 2))
    : proxyRefusal(proxied, read);
}

/** Why a read did not arrive: unconfigured, denied and anything else send a developer to check three different things. */
export function proxyRefusal(
  proxied: Extract<ProxyResult, { ok: false }>,
  { op, subject, toolName }: ProxiedRead,
): { content: [{ type: "text"; text: string }] } {
  if (proxied.reason === "not_configured") {
    return unconfiguredError(op);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  // The server's reason plainly, rather than the write-oriented "refusing local-file fallback" copy.
  return textResult(
    `Could not fetch ${subject} from the Lore API: ${proxied.detail}`,
  );
}
