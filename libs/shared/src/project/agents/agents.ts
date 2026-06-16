import type { AgentRunnerPort, AgentRunResult, AgentRunOpts } from "./agent-runner-port.js";
import type { AgentDefinition, AgentDefinitionInput, AgentDefsPort } from "./agent-defs-port.js";
import { executionRefusal } from "../lib/trust.js";

/**
 * project.agents — repo-bound. Two sides: EXECUTION (run, trust-gated: on the
 * shared GKE server it refuses local spawns before touching the runner) and
 * DEFINITIONS (resolve/list/create/update/delete), which delegate to the defs
 * port. The adapter behind the defs port (pg / http / yaml) is chosen by the
 * factory, so a runner pod transparently fetches its config over the API.
 */
export class Agents {
  constructor(
    private readonly repo: string,
    private readonly runner: AgentRunnerPort,
    private readonly defs: AgentDefsPort,
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

  /** The effective definition for a task type (project → org → yaml), or null. */
  resolve(name: string): Promise<AgentDefinition | null> {
    return this.defs.resolve(this.repo, name);
  }

  /** Every effective definition for this repo. */
  list(): Promise<AgentDefinition[]> {
    return this.defs.list(this.repo);
  }

  create(def: AgentDefinitionInput): Promise<AgentDefinition> {
    return this.defs.create(this.repo, def);
  }

  update(name: string, patch: Partial<AgentDefinitionInput>): Promise<AgentDefinition> {
    return this.defs.update(this.repo, name, patch);
  }

  delete(name: string): Promise<void> {
    return this.defs.delete(this.repo, name);
  }
}
