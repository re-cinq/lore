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

/** Generous: a catalog apply does a create, a 409 and a replace before it
 *  answers. Bounded so a wedged agent cannot hold a caller open forever. */
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
      // `code` carries the status structurally: the Floor's `isNotFound`
      // (agent-pod-logs) reads it to tell "log gone, use the archive" from a
      // genuine fault — a message-only Error made every 404 look like a 500.
      throw Object.assign(
        new Error(`cluster ${method} ${path} failed: ${res.status}`),
        { code: res.status },
      );
    }

    return res.status === 204 ? undefined : ((await res.json()) as T);
  }
}

/** The route rejects anything above 100; asking for exactly that many keeps the
 *  walk to the fewest round trips it can make. */
const PAGE_LIMIT = 100;

/**
 * {@link AgentLister} + {@link AgentStatusReader} over the agent — the READ half
 * of the cluster surface, plus the two writes a caller cannot perform locally
 * (a status patch, a delete).
 *
 * Deliberately NOT an {@link AgentApi}: it cannot create. Dispatch is pull-only,
 * so a CR is created by the agent that claimed the run, in its own cluster.
 * `POST /agents` was the last inbound push and is gone with its route.
 */
export class HttpAgentApi implements AgentLister, AgentStatusReader {
  constructor(private readonly client: ClusterAgentClient) {}

  async listByLabel(selector: string): Promise<AgentCr[]> {
    // Walked, not truncated. A label selector narrow enough to fit one page
    // today is one busy hour away from not fitting, and the failure of a
    // silently-truncated list is that it returns the WRONG answer rather than
    // an error — the caller acts on a subset it believes is the whole set.
    return collectPages<AgentCr>((continueToken?: string) => {
      const q = new URLSearchParams({
        labelSelector: selector,
        limit: String(PAGE_LIMIT),
      });

      if (continueToken) {
        q.set("continue", continueToken);
      }

      // `call` answers undefined for a 204; an empty page ends the walk, where
      // a thrown TypeError would end the caller.
      return this.client
        .call<Page<AgentCr>>("GET", `/agents?${q}`)
        .then((page) => page ?? { items: [] });
    });
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

/**
 * {@link TokenCleanup} over the agent — the reclaim half only.
 *
 * There is no HTTP mint: every launch is a claim, so the cluster that provisions
 * is the cluster that launches, in-process. What crosses the network is the
 * Floor asking a cluster to take a settled task's token back.
 */
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
