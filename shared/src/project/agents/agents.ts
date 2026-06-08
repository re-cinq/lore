import type { AgentRunnerPort, AgentRunResult, AgentRunOpts } from "./agent-runner-port.js";
import { executionRefusal } from "../lib/trust.js";

/**
 * project.agents — repo-bound execution, trust-gated. On the shared GKE server
 * it refuses before touching the runner; in a sandbox it delegates the routing
 * (local / cluster / direct) to the port.
 */
export class Agents {
  constructor(
    private readonly repo: string,
    private readonly runner: AgentRunnerPort,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async run(taskId: string, opts?: AgentRunOpts): Promise<AgentRunResult> {
    const refusal = executionRefusal(this.env);
    if (refusal) throw new Error(refusal);
    return this.runner.run(this.repo, taskId, opts);
  }
}
