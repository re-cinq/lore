import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import type { LocalRunnerConfig } from "../../../work/pipeline/runner.local.js";

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const CONFIGURE_LOCAL_RUNNER_INPUT = {
  max_concurrent: z
    .number()
    .optional()
    .describe("Max simultaneous local background tasks (positive integer)."),
  repos: z
    .array(z.string())
    .optional()
    .describe(
      "owner/repo slugs the local notifier watches (e.g. ['re-cinq/lore']). Replaces the whole list.",
    ),
  task_types: z
    .array(z.string())
    .optional()
    .describe(
      "Task-type names eligible to run locally. Replaces the whole list.",
    ),
  model: z
    .string()
    .optional()
    .describe("Default model id for local tasks (e.g. 'claude-sonnet-4-6')."),
};

interface ConfigureLocalRunnerArgs {
  max_concurrent?: number;
  repos?: string[];
  task_types?: string[];
  model?: string;
}

export function registerConfigureLocalRunnerTool(server: McpServer) {
  server.tool(
    "lore_configure_local_runner",
    `Views or updates the local runner config on your machine; returns current config as JSON when called with no arguments, or writes provided fields and returns 'Config updated:' + JSON. Controls which repos/task-types the local notifier watches and local concurrency/model limits. To run work locally use lore_run_task_locally (new task) or lore_claim_and_run_locally (existing task).`,
    CONFIGURE_LOCAL_RUNNER_INPUT,
    async (args) => {
      try {
        return await configureLocalRunner(args);
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}

/** No arguments means read, not "clear everything" — the tool doubles as the config viewer. */
async function configureLocalRunner(args: ConfigureLocalRunnerArgs) {
  const { readConfig, writeConfig } =
    await import("../../../work/pipeline/runner.local.js");
  const config = readConfig();

  if (!hasConfigureArgs(args)) {
    return textResult(JSON.stringify(config, null, 2));
  }
  const updated = applyConfigureUpdate(config, args);

  writeConfig(updated);

  return textResult(`Config updated:\n${JSON.stringify(updated, null, 2)}`);
}

function hasConfigureArgs(args: ConfigureLocalRunnerArgs): boolean {
  return Boolean(
    args.max_concurrent || args.repos || args.task_types || args.model,
  );
}

function applyConfigureUpdate(
  config: LocalRunnerConfig,
  // eslint-disable-next-line re-lint/no-duplicate-code -- the local runner's configure arguments, restated by runner.local.test.ts; that restatement IS the test, pinning the shape a developer's ~/.lore runner config must keep
  args: ConfigureLocalRunnerArgs,
): LocalRunnerConfig {
  const next = { ...config };

  if (args.max_concurrent !== undefined) {
    next.max_concurrent = args.max_concurrent;
  }

  if (args.repos) {
    next.repos = args.repos;
  }

  if (args.task_types) {
    next.task_types = args.task_types;
  }

  if (args.model) {
    next.model = args.model;
  }

  return next;
}
