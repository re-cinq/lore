import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentDefsReadPort,
  AgentDefsWritePort,
  PodResourcesWrite,
} from "./agent-defs-port.js";

/** project.agentDefs — repo-bound Agent *definitions* (config): resolve/list field-merge project → org. */
export class AgentDefs {
  constructor(
    protected readonly repo: string,
    private readonly defs: AgentDefsReadPort,
  ) {}

  /** The effective definition for a task type (project → org → yaml), or null. */
  resolve(name: string): Promise<AgentDefinition | null> {
    return this.defs.resolve(this.repo, name);
  }

  /** Every effective definition for this repo. */
  list(): Promise<AgentDefinition[]> {
    return this.defs.list(this.repo);
  }
}

/** project.agentDefsWriter — the same reads plus create/update/delete; only the floor adapter can back it. */
export class AgentDefsWriter extends AgentDefs {
  constructor(
    repo: string,
    private readonly writableDefs: AgentDefsWritePort,
  ) {
    super(repo, writableDefs);
  }

  create(def: AgentDefinitionInput): Promise<AgentDefinition> {
    return this.writableDefs.create(this.repo, def);
  }

  update(
    name: string,
    patch: Partial<AgentDefinitionInput>,
    podResources?: PodResourcesWrite,
  ): Promise<AgentDefinition> {
    return this.writableDefs.update(this.repo, name, patch, podResources);
  }

  delete(name: string): Promise<void> {
    return this.writableDefs.delete(this.repo, name);
  }
}
