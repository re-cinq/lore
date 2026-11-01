import { ASSEMBLY_PROXY_LIMITS, proxyMemory, withReadCache } from "../../shared/deps.js";
import { interpretMemoryProxy } from "./interpret-memory-proxy.js";

/** What the memory tools resolve to. `textResult` returns a one-element tuple and the proxy interpreter returns an array; naming the wider shape lets both flow out of one function. */
export type ToolText = { content: Array<{ type: "text"; text: string }> };

/** Every memory read answers the same way: the cached proxy first, the server's own answer when it has one, and the local `~/.lore/memory` store when it does not. That fallback is why these tools still answer on a laptop with no API configured. */
export async function cachedMemoryRead(
  spec: {
    tool: string;
    op: "read" | "list" | "search";
    args: Record<string, unknown>;
    repo?: string;
  },
  fromFile: () => ToolText,
): Promise<ToolText> {
  const proxied = await withReadCache(
    {
      tool: spec.tool,
      args: spec.args,
      repo: spec.repo,
      ttlSeconds: 300,
    },
    () => proxyMemory(spec.op, spec.args, limitsFor(spec.op)),
  );

  return interpretMemoryProxy(spec.tool, proxied) ?? fromFile();
}

// A search assembles from Utopia and so needs the long timeout; reading or listing a key does not.
function limitsFor(op: "read" | "list" | "search") {
  return op === "search" ? ASSEMBLY_PROXY_LIMITS : undefined;
}
