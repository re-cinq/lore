import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { proxyGetApi, textResult } from "../shared/deps.js";
import { repoParam, withRepo, type ServerMode } from "../shared/repo-scope.js";
import type { ToolTextResult } from "./shared/proxy-failure.js";
import { apiAnswer, type ApiAnswer } from "../../api/api-types.js";

type LoopState = ApiAnswer<"/api/repos/{owner}/{repo}/implementation-loop">;
type LoopIssue = LoopState["next"][number];

// The API fields we gate on may be absent in older mocks; treat them as optional at runtime.
type LoopGates = {
  enabled?: boolean;
  onboarding?: { merged?: boolean };
  current?: unknown;
};

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
  issue: LoopIssue | null;
  because?: string;
  reason?: string;
}

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

  const loopState = apiAnswer(
    "/api/repos/{owner}/{repo}/implementation-loop",
    proxied.body,
  );

  return textResult(JSON.stringify(nextReadyResult(loopState)));
}

function nextReadyResult(loopState: LoopState): NextReadyResult {
  const gate = gateReason(loopState as LoopGates);

  if (gate !== null) {
    return { issue: null, reason: gate };
  }
  const readyIssues = loopState.next.filter((i) => !i.hold);

  if (readyIssues.length === 0) {
    return { issue: null, reason: "No issues ready in the backlog." };
  }
  const issue = readyIssues[0];
  const rule = loopState.criteria?.[0] || "priority";
  const because = `${rule} (unblocks: ${issue.unblocks_count || 0})`;

  return { issue, because };
}

function gateReason(gates: LoopGates): string | null {
  if (gates.enabled === false) {
    return "The implementation loop is disabled for this repo.";
  }

  if (gates.onboarding?.merged === false) {
    return "Onboarding PR has not merged yet.";
  }

  if (isBusyNow(gates.current)) {
    return "Already working on an issue.";
  }

  return null;
}

function isBusyNow(current: unknown): boolean {
  if (current == null) {
    return false;
  }

  return !Array.isArray(current) || current.length > 0;
}
