/**
 * Agent execution/delegation port — the EXECUTION side (distinct from the
 * TaskStorePort record side). run() routes to local (background Claude Code),
 * cluster (LoreTask CR / claude --print), or the direct Anthropic API. The
 * routing lives in the adapter; the facade gates and delegates.
 */

export type AgentMode = "local" | "cluster" | "direct";

export interface AgentRunResult {
  taskId: string;
  mode: AgentMode;
  started: boolean;
}

export interface AgentRunOpts {
  mode?: AgentMode;
}

export interface AgentRunnerPort {
  run(repo: string, taskId: string, opts?: AgentRunOpts): Promise<AgentRunResult>;
}
