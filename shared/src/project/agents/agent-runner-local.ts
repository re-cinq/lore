import type { AgentRunnerPort, AgentRunResult, AgentRunOpts } from "./agent-runner-port.js";
import { runClaudeCli } from "./claude-cli.js";

/**
 * Local agent execution — spawns `claude --print` for the task via the relocated
 * spawn core. `started` reflects a clean exit. The cluster (LoreTask CR) and
 * direct (Anthropic API) modes are wired in their own adapter; here they defer.
 */
export class AgentRunnerLocal implements AgentRunnerPort {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async run(repo: string, taskId: string, opts?: AgentRunOpts): Promise<AgentRunResult> {
    const mode = opts?.mode ?? "local";
    if (mode !== "local") {
      throw new Error(`agents.run mode "${mode}" needs the cluster/direct adapter (pending)`);
    }
    const prompt = opts?.prompt ?? `Work on Lore task ${taskId} for ${repo}.`;
    const result = await runClaudeCli({
      prompt,
      workDir: opts?.workDir,
      model: opts?.model,
      env: this.env,
    });
    return { taskId, mode: "local", started: result.exitCode === 0 };
  }
}
