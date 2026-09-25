import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proxyGetApi, textResult } from "./deps.js";
import { interpretMemoryProxy } from "./interpret-memory-proxy.js";

// The plan-reading half of the planning tool surface: an agent reads the plan it is working on before editing it.

export function registerPlanTools(server: McpServer) {
  registerPlanReadTool(server);
}

function registerPlanReadTool(server: McpServer) {
  server.tool(
    "lore_plan_read",
    `Reads the plan an agent is working on: every section with its blocks {id, type, hash, text, props}. Read before editing — the hash goes into lore_plan_edit's expect.`,
    { plan_id: z.string().min(1) },
    planReadHandler,
  );
}

async function planReadHandler({ plan_id }: { plan_id: string }) {
  try {
    const proxied = await proxyGetApi(`/api/plans/${plan_id}/agent-view`);

    return (
      interpretMemoryProxy("lore_plan_read", proxied) ??
      textResult(
        "Reading a plan requires a configured LORE_API_URL.",
      )
    );
  } catch (err) {
    return textResult(`Error reading plan: ${errorMessage(err)}`);
  }
}
