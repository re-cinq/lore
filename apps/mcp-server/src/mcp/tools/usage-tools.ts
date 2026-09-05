import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  proxyGetApi,
  notConfiguredError,
  deniedError,
  type ProxyResult,
  textResult,
} from "./deps.js";

// Usage + analytics read from pipeline.tasks/pipeline.llm_calls, reachable only by the remote API (no local pool, ADR-032); both tools just proxy and pretty-print.

/** Pretty-print a proxied JSON body, or map the failure to tool text. */
function renderProxied(
  proxied: ProxyResult,
  { op, subject, toolName }: { op: string; subject: string; toolName: string },
): { content: [{ type: "text"; text: string }] } {
  if (proxied.ok) {
    return textResult(JSON.stringify(JSON.parse(proxied.body), null, 2));
  }

  if (proxied.reason === "not_configured") {
    return notConfiguredError(op);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  // A read with no local fallback: surface the server's reason plainly rather than the write-oriented "refusing local-file fallback" copy.
  return textResult(
    `Could not fetch ${subject} from the Lore API: ${proxied.detail}`,
  );
}

export function registerUsageTools(server: McpServer) {
  server.tool(
    "lore_my_usage",
    `Reports the calling agent's own task count and input/output token totals across three windows (today, 7_day, 30_day); returns { agent_id, usage: { today, 7_day, 30_day } }. Instead: for org-wide throughput, success rates, and per-type breakdown use lore_get_analytics — this tool is single-agent only and does not report success rates or per-type counts.`,
    {
      agent_id: z
        .string()
        .optional()
        .describe(
          "Agent identifier (email or UUID). Auto-detected from caller when omitted. Pass only to inspect a different agent.",
        ),
    },
    async ({ agent_id }) => {
      try {
        const params = new URLSearchParams({
          agent_id: resolveAgentId(agent_id),
        });

        return renderProxied(await proxyGetApi(`/api/usage?${params}`), {
          op: "reading usage",
          subject: "usage",
          toolName: "lore_my_usage",
        });
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );

  server.tool(
    "lore_get_analytics",
    `Returns org-wide pipeline analytics for a time window: { period, usage: { llm_calls, input_tokens, output_tokens }, tasks: { total, succeeded, failed }, by_type }. Note: by_type[].tasks is a numeric string (raw pg bigint). Instead: for a single agent's own footprint use lore_my_usage — this tool is not per-agent and does not filter by caller.`,
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .default("month")
        .describe('"today", "week", "month", or "all" (no time filter).'),
    },
    async ({ period }) => {
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
    },
  );
}
