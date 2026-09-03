// Reaching this cluster through its agent: one transport, then one adapter per existing port, so the Floor's call sites keep their shape.

import type {
  Agent as AgentCr,
  AgentDefinition,
  Station,
} from "@re-cinq/agent-contracts";
import { collectPages, type Page } from "../lib/paginate.js";
import type { AgentNodeStatus } from "./agent-node-status.js";
import type {
  AgentLister,
  AgentStatusReader,
  TokenCleanup,
} from "./cluster-ports.js";
import type {
  AgentPodInfo,
  PodSummary,
  PodLogSource,
} from "./pod-logs-port.js";

/** Generous: a catalog apply does a create, a 409, and a replace before it answers; bounded so a wedged agent cannot hold a caller open forever. */
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

/** Route rejects above 100; asking for 100 keeps walk to fewest round trips. */
const PAGE_LIMIT = 100;

/** {@link AgentLister} + {@link AgentStatusReader} over the agent — the READ half plus status-patch/delete. Deliberately NOT an {@link AgentApi}: dispatch is pull-only, so `POST /agents` is gone with its route. */
export class HttpAgentApi implements AgentLister, AgentStatusReader {
  constructor(private readonly client: ClusterAgentClient) {}

  async listByLabel(selector: string): Promise<AgentCr[]> {
    // Walked, not truncated — a silently-truncated list returns the WRONG answer, not an error, and the caller acts on a subset it believes is the whole set.
    return collectPages<AgentCr>((continueToken?: string) => {
      const q = new URLSearchParams({
        labelSelector: selector,
        limit: String(PAGE_LIMIT),
      });

      if (continueToken) {
        q.set("continue", continueToken);
      }

      // `call` answers undefined for a 204; an empty page ends the walk, where a thrown TypeError would end the caller.
      return this.client
        .call<Page<AgentCr>>("GET", `/agents?${q}`)
        .then((page) => page ?? { items: [] });
    });
  }

  /** One page — the caller drives `continue`; a one-shot list is not offered. */
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
}

/** {@link PodLogSource} over the agent — the pod reads the Floor gave up. */
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

/** {@link TokenCleanup} over the agent — reclaim half only; there is no HTTP mint since every launch is a claim, in-process on the provisioning cluster. */
export class HttpTokenCleanup implements TokenCleanup {
  constructor(private readonly client: ClusterAgentClient) {}

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
