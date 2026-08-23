// Reaching this cluster through its agent.
//
// One transport, then one adapter per existing port — so the Floor's call sites
// keep their shape and a green Floor suite is the evidence the adapters are
// faithful. Nothing here knows Kubernetes; the agent on the other end does.

import type {
  Agent as AgentCr,
  AgentDefinition,
  Station,
} from "@re-cinq/agent-contracts";
import type { AgentNodeStatus } from "./agent-node-status.js";
import type {
  AgentApi,
  AgentStatusReader,
  TokenProvisioner,
  TokenCleanup,
} from "./cluster-ports.js";
import type {
  AgentPodInfo,
  PodSummary,
  PodLogSource,
} from "./pod-logs-port.js";
import type { LoreTaskSpec } from "../project/agents/k8s-port.js";

/** Generous: a provision does a catalog read, a GitHub mint and a retried
 *  Secret write before it answers. Bounded so a wedged agent cannot hold a
 *  dispatch open forever. */
const TIMEOUT_MS = 60_000;

export class ClusterAgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | undefined> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.token) {
      headers["authorization"] = `Bearer ${this.token}`;
    }
    const res = await this.fetchImpl(`${this.baseUrl}/api/cluster${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`cluster ${method} ${path} failed: ${res.status}`);
    }

    return res.status === 204 ? undefined : ((await res.json()) as T);
  }
}

/** {@link AgentApi} + {@link AgentStatusReader} over the agent. */
export class HttpAgentApi implements AgentApi, AgentStatusReader {
  constructor(private readonly client: ClusterAgentClient) {}

  async create(agent: AgentCr): Promise<{ name: string; created: boolean }> {
    return (await this.client.call<{ name: string; created: boolean }>(
      "POST",
      "/agents",
      agent,
    ))!;
  }

  async listByLabel(selector: string): Promise<AgentCr[]> {
    const page = await this.client.call<{ items: AgentCr[] }>(
      "GET",
      `/agents?labelSelector=${encodeURIComponent(selector)}&limit=100`,
    );

    return page?.items ?? [];
  }

  /** One page. The caller drives `continue` — see the route's comment on why a
   *  one-shot list is not offered. */
  async listPage(opts: {
    limit: number;
    continue?: string;
  }): Promise<{ items: AgentCr[]; continueToken?: string }> {
    const q = new URLSearchParams({ limit: String(opts.limit) });

    if (opts.continue) {
      q.set("continue", opts.continue);
    }

    return (await this.client.call<{
      items: AgentCr[];
      continueToken?: string;
    }>("GET", `/agents?${q}`))!;
  }

  async get(name: string): Promise<AgentCr | null> {
    const res = await this.client.call<{ found: boolean; cr: AgentCr | null }>(
      "GET",
      `/agents/${encodeURIComponent(name)}`,
    );

    return res?.cr ?? null;
  }

  async getStatus(name: string): Promise<AgentNodeStatus | null> {
    const cr = await this.get(name);

    return (cr?.status as AgentNodeStatus | undefined) ?? null;
  }

  async remove(name: string): Promise<void> {
    await this.client.call("DELETE", `/agents/${encodeURIComponent(name)}`);
  }

  async patchStatus(
    name: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.client.call(
      "PATCH",
      `/agents/${encodeURIComponent(name)}/status`,
      { patch },
    );
  }
}

/** {@link PodLogSource} over the agent. */
export class HttpPodLogSource implements PodLogSource {
  constructor(private readonly client: ClusterAgentClient) {}

  async agentInfo(name: string): Promise<AgentPodInfo | null> {
    const res = await this.client.call<{
      found: boolean;
      phase: string | null;
      jobName: string | null;
    }>("GET", `/agents/${encodeURIComponent(name)}/pod-info`);

    return res?.found ? { phase: res.phase, jobName: res.jobName } : null;
  }

  async podsForJob(jobName: string): Promise<PodSummary[]> {
    const res = await this.client.call<{ pods: PodSummary[] }>(
      "GET",
      `/jobs/${encodeURIComponent(jobName)}/pods`,
    );

    return res?.pods ?? [];
  }

  async podLog(podName: string, tailLines?: number): Promise<string> {
    const q = tailLines === undefined ? "" : `?tail=${tailLines}`;
    const res = await this.client.call<{ logs: string }>(
      "GET",
      `/pods/${encodeURIComponent(podName)}/log${q}`,
    );

    return res?.logs ?? "";
  }
}

/** {@link TokenProvisioner} + {@link TokenCleanup} over the agent. */
export class HttpTokenProvisioner implements TokenProvisioner, TokenCleanup {
  constructor(private readonly client: ClusterAgentClient) {}

  async provision(spec: LoreTaskSpec): Promise<string | undefined> {
    const res = await this.client.call<{ name: string | null }>(
      "POST",
      "/per-task-tokens",
      spec,
    );

    return res?.name ?? undefined;
  }

  async cleanup(taskId: string): Promise<void> {
    await this.client.call(
      "DELETE",
      `/per-task-tokens/${encodeURIComponent(taskId)}`,
    );
  }
}

/** The UI-authored catalog, over the agent — lore-api's only cluster need. */
export class HttpAgentCatalog {
  constructor(private readonly client: ClusterAgentClient) {}

  async applyPair(pair: {
    agentDefinition: AgentDefinition;
    station: Station;
  }): Promise<void> {
    await this.client.call("POST", "/catalog/pairs", pair);
  }

  async deletePair(name: string): Promise<void> {
    await this.client.call(
      "DELETE",
      `/catalog/pairs/${encodeURIComponent(name)}`,
    );
  }
}
