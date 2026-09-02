import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentDefsPort,
  PodResourcesWrite,
} from "./agent-defs-port.js";

/**
 * project.agentDefs — repo-bound Agent *definitions* (config), the CRUD side
 * kept separate from execution (`project.agents.run()`). A definition is the
 * stored recipe — model, timeout, prompt, image — a Station instantiates into an
 * Agent (ADR-024); one definition, many runs. resolve/list field-merge
 * project → org → yaml. The adapter behind the port (pg / http / yaml) is chosen
 * by the factory, so a runner pod transparently fetches its config over the API.
 */
export class AgentDefs {
  constructor(
    private readonly repo: string,
    private readonly defs: AgentDefsPort,
  ) {}

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

  update(
    name: string,
    patch: Partial<AgentDefinitionInput>,
    podResources?: PodResourcesWrite,
  ): Promise<AgentDefinition> {
    return this.defs.update(this.repo, name, patch, podResources);
  }

  delete(name: string): Promise<void> {
    return this.defs.delete(this.repo, name);
  }
}
