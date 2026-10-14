// Read-only AgentDefsReadPort over the shipped defaults (libs/shared/src/agent-defaults) for a process with neither a database nor the API; writes throw.

import { loadAgentDefaults } from "./agent-defaults-files.js";
import type { AgentDefinition, AgentDefsReadPort } from "./agent-defs-port.js";

export class AgentDefsFiles implements AgentDefsReadPort {
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
    return this.load();
  }
}
