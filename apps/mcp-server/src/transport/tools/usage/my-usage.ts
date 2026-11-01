import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveAgentId } from "@re-cinq/lore-shared";
import { proxyGetApi, textResult } from "../shared/deps.js";
import { renderProxied } from "./shared/render-proxied.js";

const MY_USAGE_INPUT = {
  agent_id: z
    .string()
    .optional()
    .describe(
      "Agent identifier (email or UUID). Auto-detected from caller when omitted. Pass only to inspect a different agent.",
    ),
};

export function registerMyUsageTool(server: McpServer) {
  server.tool(
    "lore_my_usage",
    `Reports the calling agent's own task count and input/output token totals across three windows (today, 7_day, 30_day); returns { agent_id, usage: { today, 7_day, 30_day } }. Instead: for org-wide throughput, success rates, and per-type breakdown use lore_get_analytics — this tool is single-agent only and does not report success rates or per-type counts.`,
    MY_USAGE_INPUT,
    handleMyUsage,
  );
}

async function handleMyUsage({ agent_id }: { agent_id?: string }) {
  try {
    const params = new URLSearchParams({ agent_id: resolveAgentId(agent_id) });

    return renderProxied(await proxyGetApi(`/api/usage?${params}`), {
      op: "reading usage",
      subject: "usage",
      toolName: "lore_my_usage",
    });
  } catch (err) {
    return textResult(`Error: ${errorMessage(err)}`);
  }
}
