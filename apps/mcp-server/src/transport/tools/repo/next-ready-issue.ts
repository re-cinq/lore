import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { proxyGetApi, textResult } from "../shared/deps.js";
import { repoParam, withRepo, type ServerMode } from "../shared/repo-scope.js";
import type { ToolTextResult } from "./shared/proxy-failure.js";

export function registerNextReadyIssueTool(
  server: McpServer,
  mode: ServerMode,
) {
  server.tool(
    "lore_next_ready_issue",
    `Returns the issue the implementation loop would pick next for a repo: number, title, url, and a \`because\` field naming the rule that selected it. Returns { issue: null, reason } when nothing is ready — never an error. Use to preview which ticket the loop would start next without dispatching it.`,
    { repo: repoParam(mode) },
    (args: { repo?: string }) => withRepo(args, mode, fetchNextReadyIssue),
  );
}

interface NextReadyResult {
  issue: Record<string, unknown> | null;
  because?: string;
  reason?: string;
}

type LoopState = { next?: Array<Record<string, unknown>>; criteria?: string[] };
async function fetchNextReadyIssue(args: {
  repo: string;
}): Promise<ToolTextResult> {
  const proxied = await proxyGetApi(
    `/api/repos/${args.repo}/implementation-loop`,
  );

  if (!proxied.ok) {
    return textResult(
      JSON.stringify({ issue: null, reason: "Could not reach Lore API." }),
    );
  }

  return textResult(
    JSON.stringify(nextReadyResult(JSON.parse(proxied.body) as LoopState)),
  );
}

function nextReadyResult(loopState: {
  next?: Array<Record<string, unknown>>;
  criteria?: string[];
}): NextReadyResult {
  const issues = loopState.next || [];
  const readyIssues = issues.filter((i) => !i.hold);

  if (readyIssues.length === 0) {
    return { issue: null, reason: "No issues ready in the backlog." };
  }

  const issue = readyIssues[0];
  const rule = loopState.criteria?.[0] || "priority";
  const because = `${rule} (unblocks: ${issue.unblocks_count || 0})`;

  return { issue, because };
}
