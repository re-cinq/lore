import type { AgentRunnerPort, AgentRunResult, AgentRunOpts } from "./agent-runner-port.js";
import { executionRefusal } from "../lib/trust.js";

/**
 * project.agents — repo-bound EXECUTION. An Agent is one ephemeral run of the
 * Claude CLI/API + a prompt (ADR-024); `run()` is trust-gated, so on the shared
 * GKE server it refuses local spawns before touching the runner. The stored
 * config an Agent runs from is an *Agent definition* — see `project.agentDefs`
 * (AgentDefs); they are deliberately separate facades.
 */
export class Agents {
  constructor(
    private readonly repo: string,
    private readonly runner: AgentRunnerPort,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async run(taskId: string, opts?: AgentRunOpts): Promise<AgentRunResult> {
    // Only LOCAL mode spawns a process on this host, so only it is bound by the
    // local-execution trust gate. cluster (k8s CR) and direct (API) are remote
    // calls the agent legitimately makes even on the cluster (LORE_DB_HOST set).
    const mode = opts?.mode ?? "local";
    if (mode === "local") {
      const refusal = executionRefusal(this.env);
      if (refusal) throw new Error(refusal);
    }
    return this.runner.run(this.repo, taskId, opts);
  }
}
