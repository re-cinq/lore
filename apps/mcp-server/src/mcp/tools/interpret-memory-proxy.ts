import {
  unreachableError,
  deniedError,
  textResult,
  type ProxyResult,
} from "./deps.js";

/** The ok/unreachable/denied handling shared by every proxied memory/graph tool; null means the caller should fall back. */
export function interpretMemoryProxy(
  toolName: string,
  proxied: ProxyResult,
  onOk?: () => void,
): { content: Array<{ type: "text"; text: string }> } | null {
  if (proxied.ok) {
    onOk?.();

    return textResult(proxied.body);
  }

  if (proxied.reason === "unreachable") {
    return unreachableError(toolName, proxied.detail);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  return null;
}
