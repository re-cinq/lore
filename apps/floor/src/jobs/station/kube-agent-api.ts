// Live AgentApi over @kubernetes/client-node (lazily imported, as in k8s-loretask.ts).
// The thin IO seam behind the AgentApi port — the mapping/decision logic it backs
// lives in agent-backend.ts and is covered there. Creates/lists `Agent` CRs in the
// ai-agents namespace (agents.re-cinq.com); a 409 maps to created:false.

import { GROUP, VERSION, type Agent as AgentCr } from "@re-cinq/agent-contracts";
import type { AgentNodeStatus } from "@re-cinq/lore-assembly-lines";
import type { AgentApi } from "./agent-backend.js";

const PLURAL = "agents";

export class KubeAgentApi implements AgentApi {
  private namespace(): string {
    return process.env.LORE_AGENTS_NAMESPACE ?? "ai-agents";
  }

  private async customObjects() {
    const { KubeConfig, CustomObjectsApi } = await import("@kubernetes/client-node");
    const kc = new KubeConfig();
    kc.loadFromCluster();
    return kc.makeApiClient(CustomObjectsApi);
  }

  async create(agent: AgentCr): Promise<{ name: string; created: boolean }> {
    const api = await this.customObjects();
    const namespace = this.namespace();
    const name = agent.metadata?.name ?? "";
    const body = { apiVersion: `${GROUP}/${VERSION}`, kind: "Agent", ...agent };
    try {
      await api.createNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, body });
      return { name, created: true };
    } catch (err) {
      const e = err as { code?: number; response?: { statusCode?: number }; message?: string };
      const is409 =
        e?.code === 409 ||
        e?.response?.statusCode === 409 ||
        String(e?.message).includes("already exists");
      if (is409) return { name, created: false };
      throw err;
    }
  }

  /** The status of one Agent CR by name (the per-node Agent, `<id8>-<nodeId>`), as the
   *  graph handler's poll expects. Null when the CR doesn't exist yet (404). */
  async getStatus(name: string): Promise<AgentNodeStatus | null> {
    const api = await this.customObjects();
    try {
      const obj = (await api.getNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace(),
        plural: PLURAL,
        name,
      })) as AgentCr;
      const status = obj.status;
      if (!status) return null;
      return { phase: status.phase, output: status.output, failureReason: status.failureReason };
    } catch (err) {
      const e = err as { code?: number; response?: { statusCode?: number } };
      if (e?.code === 404 || e?.response?.statusCode === 404) return null;
      throw err;
    }
  }

  async listByLabel(selector: string): Promise<AgentCr[]> {
    const api = await this.customObjects();
    const res = (await api.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: this.namespace(),
      plural: PLURAL,
      labelSelector: selector,
    })) as { items?: AgentCr[]; body?: { items?: AgentCr[] } };
    return res.items ?? res.body?.items ?? [];
  }
}
