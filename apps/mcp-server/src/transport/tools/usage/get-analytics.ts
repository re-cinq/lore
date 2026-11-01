import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proxyGetApi, textResult } from "../shared/deps.js";
import { renderProxied } from "./shared/render-proxied.js";

const ANALYTICS_INPUT = {
  period: z
    .enum(["today", "week", "month", "all"])
    .default("month")
    .describe('"today", "week", "month", or "all" (no time filter).'),
};

export function registerGetAnalyticsTool(server: McpServer) {
  server.tool(
    "lore_get_analytics",
    `Returns org-wide pipeline analytics for a time window: { period, usage: { llm_calls, input_tokens, output_tokens }, tasks: { total, succeeded, failed }, by_type }. Note: by_type[].tasks is a numeric string (raw pg bigint). Instead: for a single agent's own footprint use lore_my_usage — this tool is not per-agent and does not filter by caller.`,
    ANALYTICS_INPUT,
    handleGetAnalytics,
  );
}

async function handleGetAnalytics({
  period,
}: {
  period: "today" | "week" | "month" | "all";
}) {
  try {
    const params = new URLSearchParams({ period });

    return renderProxied(await proxyGetApi(`/api/analytics?${params}`), {
      op: "fetching analytics",
      subject: "analytics",
      toolName: "lore_get_analytics",
    });
  } catch (err) {
    return textResult(`Error fetching analytics: ${errorMessage(err)}`);
  }
}
