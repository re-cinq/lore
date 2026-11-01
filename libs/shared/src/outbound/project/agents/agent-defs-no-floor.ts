// The agent definitions port of a process given neither a floor nor the API: the floor is their only store, read there from what each cluster's kube holds, so there is nothing else to answer from.

import type { AgentDefinition, AgentDefsReadPort } from "./agent-defs-port.js";

export const NO_FLOOR_DETAIL =
  "Agent definitions live on the floor, and this deployment has none: " +
  "set FLOOR_API_URL and FLOOR_SERVICE_TOKEN to read or edit them.";

export class NoFloorAgentDefs implements AgentDefsReadPort {
  async resolve(_repo: string, _name: string): Promise<AgentDefinition | null> {
    throw new Error(NO_FLOOR_DETAIL);
  }

  async list(_repo: string): Promise<AgentDefinition[]> {
    throw new Error(NO_FLOOR_DETAIL);
  }
}
