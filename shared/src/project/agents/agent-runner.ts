import type { AgentRunnerPort, AgentRunResult, AgentRunOpts } from "./agent-runner-port.js";
import type { LlmPort } from "./llm-port.js";
import type { K8sPort } from "./k8s-port.js";
import { runClaudeCli } from "./claude-cli.js";

/**
 * Agent execution across all three modes, routing to injected providers:
 *  - local   → spawn `claude --print` (relocated spawn core, no provider needed)
 *  - cluster → create a LoreTask CR via the injected K8sPort
 *  - direct  → call the injected LlmPort (Anthropic SDK lives in the runtime)
 * A mode whose provider is absent throws a clear error.
 */
export class AgentRunner implements AgentRunnerPort {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly providers: { k8s?: K8sPort; llm?: LlmPort } = {},
  ) {}

  async run(repo: string, taskId: string, opts?: AgentRunOpts): Promise<AgentRunResult> {
    const mode = opts?.mode ?? "local";
    const prompt = opts?.prompt ?? `Work on Lore task ${taskId} for ${repo}.`;

    if (mode === "local") {
      const result = await runClaudeCli({ prompt, workDir: opts?.workDir, model: opts?.model, env: this.env });
      return { taskId, mode, started: result.exitCode === 0 };
    }

    if (mode === "cluster") {
      const k8s = this.providers.k8s;
      if (!k8s) throw new Error('agents.run mode "cluster" needs a K8sPort provider');
      const res = await k8s.createLoreTask({
        taskId,
        taskType: opts?.taskType ?? "general",
        description: opts?.description ?? "",
        prompt,
        targetRepo: repo,
        branch: opts?.branch ?? `lore/task-${taskId}`,
        model: opts?.model,
      });
      return { taskId, mode, started: res.created };
    }

    const llm = this.providers.llm;
    if (!llm) throw new Error('agents.run mode "direct" needs an LlmPort provider');
    await llm.complete(prompt, { model: opts?.model });
    return { taskId, mode, started: true };
  }
}
