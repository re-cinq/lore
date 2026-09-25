import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proxyGetApi, proxyToApi, textResult } from "./deps.js";
import { interpretMemoryProxy } from "./interpret-memory-proxy.js";

// The op shapes agent-edits accepts (append-to-section / replace-block / remove-block, etc.);
// kept as a record here rather than importing @re-cinq/planning-document's schema, which would
// pull the git dependency into the mcp-server's lean install (ADR-032).
const agentOpSchema = z.record(z.string(), z.unknown());

// The plan-reading half of the planning tool surface: an agent reads the plan it is working on before editing it.

export function registerPlanTools(server: McpServer) {
  registerPlanReadTool(server);
  registerPlanEditTool(server);
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

function registerPlanEditTool(server: McpServer) {
  server.tool(
    "lore_plan_edit",
    `Applies ONE agent op to the live plan; read first with lore_plan_read. For replace-block/remove-block pass expect {blockId, hash} from the read. A refused edit means a person changed that block: read again and keep their words.`,
    {
      plan_id: z.string().min(1),
      op: agentOpSchema,
      expect: z
        .object({ blockId: z.string().min(1), hash: z.string().min(1) })
        .optional(),
    },
    planEditHandler,
  );
}

async function planEditHandler({
  plan_id,
  op,
  expect,
}: {
  plan_id: string;
  op: Record<string, unknown>;
  expect?: { blockId: string; hash: string };
}) {
  try {
    const proxied = await proxyToApi(`/api/plans/${plan_id}/agent-edits`, {
      actor: "planning-agent",
      ops: [op],
      expect,
    });

    return (
      interpretMemoryProxy("lore_plan_edit", proxied) ??
      textResult("Editing a plan requires a configured LORE_API_URL.")
    );
  } catch (err) {
    return textResult(`Error editing plan: ${errorMessage(err)}`);
  }
}
