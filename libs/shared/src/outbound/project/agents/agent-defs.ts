import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentDefsReadPort,
  AgentDefsWritePort,
  ConfigWrite,
} from "./agent-defs-port.js";

export interface RepoSettingsReader {
  rawSettings(repo: string): Promise<Record<string, unknown> | null>;
}

function baseImageOf(
  raw: Record<string, unknown> | null | undefined,
): string | null {
  const value = raw?.base_image;

  return typeof value === "string" && value.length > 0 ? value : null;
}

/** project.agentDefs — repo-bound Agent *definitions* (config): resolve/list field-merge project → org. */
export class AgentDefs {
  constructor(
    protected readonly repo: string,
    private readonly defs: AgentDefsReadPort,
    private readonly settings?: RepoSettingsReader,
  ) {}

  private async baseImage(): Promise<string | null> {
    if (!this.settings) {
      return null;
    }

    return baseImageOf(await this.settings.rawSettings(this.repo));
  }

  /** The effective definition for a task type (project → org → yaml), or null. */
  async resolve(name: string): Promise<AgentDefinition | null> {
    return this.defs.resolve(this.repo, name, await this.baseImage());
  }

  /** Every effective definition for this repo. */
  async list(): Promise<AgentDefinition[]> {
    return this.defs.list(this.repo, await this.baseImage());
  }
}

/** project.agentDefsWriter — the same reads plus create/update/delete; only the floor adapter can back it. */
export class AgentDefsWriter extends AgentDefs {
  constructor(
    repo: string,
    private readonly writableDefs: AgentDefsWritePort,
    settings?: RepoSettingsReader,
  ) {
    super(repo, writableDefs, settings);
  }

  create(def: AgentDefinitionInput): Promise<AgentDefinition> {
    return this.writableDefs.create(this.repo, def);
  }

  update(
    name: string,
    patch: Partial<AgentDefinitionInput>,
    podResources?: ConfigWrite,
  ): Promise<AgentDefinition> {
    return this.writableDefs.update(this.repo, name, patch, podResources);
  }

  delete(name: string): Promise<void> {
    return this.writableDefs.delete(this.repo, name);
  }
}
