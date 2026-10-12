// Read-only AgentDefsPort over the shipped defaults (libs/shared/src/agent-defaults) for a process with neither a database nor the API; writes throw.

import { loadAgentDefaults } from "./agent-defaults-files.js";
import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentDefsPort,
} from "./agent-defs-port.js";

const READ_ONLY = "agent definitions are read-only without a database";

export class AgentDefsFiles implements AgentDefsPort {
  private cache: AgentDefinition[] | null = null;

  constructor(private readonly dir?: string) {}

  private load(): AgentDefinition[] {
    this.cache ??= loadAgentDefaults(this.dir);

    return this.cache;
  }

  async resolve(_repo: string, name: string): Promise<AgentDefinition | null> {
    return this.load().find((def) => def.name === name) ?? null;
  }

  async list(_repo: string): Promise<AgentDefinition[]> {
    // eslint-disable-next-line re-lint/no-duplicate-code -- the offline agent-definitions adapter; its unsupported-write methods exist to satisfy the port, and no-forwarding-class bans the base class that would declare them once
    return this.load();
  }

  async create(
    _repo: string,
    _def: AgentDefinitionInput,
  ): Promise<AgentDefinition> {
    throw new Error(READ_ONLY);
  }

  async update(
    _repo: string,
    _name: string,
    _patch: Partial<AgentDefinitionInput>,
  ): Promise<AgentDefinition> {
    throw new Error(READ_ONLY);
  }

  async delete(_repo: string, _name: string): Promise<void> {
    throw new Error(READ_ONLY);
  }
}
