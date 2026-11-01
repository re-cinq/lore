import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proxyToApi, textResult } from "../shared/deps.js";
import {
  NOT_CONFIGURED,
  proxyFailure,
  type ToolTextResult,
} from "./shared/proxy-failure.js";

const ONBOARD_REPO_INPUT = {
  full_name: z
    .string()
    .describe('"owner/repo" format; both segments must be non-empty.'),
  reonboard: z
    .boolean()
    .optional()
    .describe(
      "Update run over an already-onboarded repo: one assembly run that refreshes Lore's own files wherever they drifted (workflows, lore issue templates), adds any file newly required, realigns the instruction-written workflows, and opens ONE PR — or none when the setup is already current. Still refused while an onboard task is in flight or its onboarding PR is open.",
    ),
};

export function registerOnboardRepoTool(server: McpServer) {
  server.tool(
    "lore_onboard_repo",
    `Registers a new GitHub repo with Lore and spawns an onboard pipeline task: the Floor enrols the repo (labels, webhook, ingest callback, verbatim workflows) and the onboard assembly line authors AGENTS.md/PR-template/ADRs/spec from the onboarding ticket and opens the ONE PR asynchronously; returns { repo_id, task_id, status }. Refuses (HTTP 409) when the repo is already onboarded, still has its onboarding PR open, or already has an onboard task in flight — pass reonboard to regenerate missing scaffolding for an onboarded repo. Instead: to list repos use lore_list_repos; to push files into an already-onboarded repo use lore_ingest_files.`,
    ONBOARD_REPO_INPUT,
    onboardRepo,
  );
}

type OnboardArgs = { full_name: string; reonboard?: boolean };

async function onboardRepo(args: OnboardArgs): Promise<ToolTextResult> {
  const repo = args.full_name;
  const reonboard = args.reonboard;
  const proxied = await proxyToApi("/api/onboard", { repo, reonboard });

  if (proxied.ok) {
    return textResult(proxied.body);
  }

  const isConflict = proxied.reason === "unreachable" && proxied.status === 409;

  if (isConflict && proxied.body) {
    return textResult(proxied.body);
  }

  return proxyFailure("lore_onboard_repo", NOT_CONFIGURED, proxied);
}
