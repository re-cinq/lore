// Live AgentApi over @kubernetes/client-node (lazily imported, as in k8s-loretask.ts).
// The thin IO seam behind the AgentApi port — the mapping/decision logic it backs
// lives in agent-backend.ts and is covered there. Creates/lists `Agent` CRs in the
// ai-agents namespace (agents.re-cinq.com); a 409 maps to created:false.

import { GROUP, VERSION, type Agent } from "@re-cinq/agent-contracts";
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

  async create(agent: Agent): Promise<{ name: string; created: boolean }> {
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

  async listByLabel(selector: string): Promise<Agent[]> {
    const api = await this.customObjects();
    const res = (await api.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: this.namespace(),
      plural: PLURAL,
      labelSelector: selector,
    })) as { items?: Agent[]; body?: { items?: Agent[] } };
    return res.items ?? res.body?.items ?? [];
  }
}
