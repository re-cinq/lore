import { enforceTrue } from "../../lib/enforce.js";
import { randomUUID } from "node:crypto";
import type { ClusterAgent } from "../../models/cluster-agent.js";
import type {
  ClusterAgentsRepository,
  RegisterClusterAgentInput,
} from "./cluster-agents-port.js";

/**
 * The behavioral spec of {@link ClusterAgentsRepository}, backed by a Map.
 * The contract test runs against this and the Pg adapter alike.
 */
export class InMemoryClusterAgents implements ClusterAgentsRepository {
  private readonly agents = new Map<string, ClusterAgent>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async findByName(name: string): Promise<ClusterAgent | null> {
    return (
      [...this.agents.values()].find((agent) => agent.name === name) ?? null
    );
  }

  async findById(id: string): Promise<ClusterAgent | null> {
    return this.agents.get(id) ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<ClusterAgent | null> {
    return (
      [...this.agents.values()].find(
        (agent) => agent.tokenHash === tokenHash,
      ) ?? null
    );
  }

  async create(input: RegisterClusterAgentInput): Promise<ClusterAgent | null> {
    // Synchronous check-and-set — an await here would reopen the very
    // check-then-insert race the null return exists to close.
    if ([...this.agents.values()].some((agent) => agent.name === input.name)) {
      return null;
    }

    const at = this.now();
    const agent: ClusterAgent = {
      id: randomUUID(),
      name: input.name,
      tags: input.tags,
      tokenHash: input.tokenHash,
      registeredAt: at,
      lastSeenAt: at,
      status: "active",
      paused: false,
      clusterInfo: input.clusterInfo,
    };

    this.agents.set(agent.id, agent);

    return agent;
  }

  async rotate(
    id: string,
    input: RegisterClusterAgentInput,
  ): Promise<ClusterAgent> {
    const existing = this.agents.get(id);

    enforceTrue(existing, Error, `cluster agent ${id} not found`);
    const rotated: ClusterAgent = {
      ...existing,
      tags: input.tags,
      tokenHash: input.tokenHash,
      clusterInfo: input.clusterInfo,
      lastSeenAt: this.now(),
      status: "active",
    };

    this.agents.set(id, rotated);

    return rotated;
  }

  async heartbeat(id: string, at: Date): Promise<void> {
    const existing = this.agents.get(id);

    if (existing) {
      this.agents.set(id, { ...existing, lastSeenAt: at, status: "active" });
    }
  }

  async setPaused(id: string, paused: boolean): Promise<ClusterAgent | null> {
    const existing = this.agents.get(id);

    if (!existing) {
      return null;
    }
    const updated: ClusterAgent = { ...existing, paused };

    this.agents.set(id, updated);

    return updated;
  }

  async markOffline(cutoff: Date): Promise<ClusterAgent[]> {
    const newlyOffline = [...this.agents.values()].filter(
      (agent) => agent.status === "active" && agent.lastSeenAt < cutoff,
    );

    for (const agent of newlyOffline) {
      this.agents.set(agent.id, { ...agent, status: "offline" });
    }

    return newlyOffline.map((agent) => ({ ...agent, status: "offline" }));
  }

  async list(): Promise<ClusterAgent[]> {
    return [...this.agents.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
}
