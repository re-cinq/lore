import type {
  AgentRunnerPort,
  AgentRunResult,
  AgentRunOpts,
} from "./agent-runner-port.js";
import { executionRefusal } from "../lib/trust.js";

// project.agents — repo-bound execution; trust-gated run() refuses local spawns on shared GKE.
export class Agents {
  constructor(
    private readonly repo: string,
    private readonly runner: AgentRunnerPort,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async run(taskId: string, opts?: AgentRunOpts): Promise<AgentRunResult> {
    // Only LOCAL mode spawns on this host; cluster (k8s CR) and direct (API) are remote calls.
    const mode = opts?.mode ?? "local";
    const refusal = mode === "local" ? executionRefusal(this.env) : null;

    if (refusal) {
      throw new Error(refusal);
    }

    return this.runner.run(this.repo, taskId, opts);
  }
}
