import {
  deniedError,
  failedProxyError,
  textResult,
  type ProxyResult,
} from "../../shared/deps.js";

export type ToolTextResult = ReturnType<typeof textResult>;

export const NOT_CONFIGURED =
  "Repo management requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.";

export function proxyFailure(
  toolName: string,
  unconfiguredText: string,
  proxied: Extract<ProxyResult, { ok: false }>,
): ToolTextResult {
  if (proxied.reason === "not_configured") {
    return textResult(unconfiguredText);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  return failedProxyError(toolName, proxied);
}
