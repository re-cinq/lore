// Live AgentApi over @kubernetes/client-node — the thin IO seam behind the AgentApi port (mapping/decision logic lives in agent-backend.ts); creates/lists Agent CRs, a 409 maps to created:false.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { agentsNamespace } from "@re-cinq/lore-shared";
import type { AgentApi } from "@re-cinq/lore-shared";
import {
  AGENT_API_VERSION,
  GROUP,
  VERSION,
  AGENT_PLURAL as PLURAL,
} from "./crd.js";
import { customObjectsApi } from "./kube-clients.js";
import { isConflict } from "./k8s-errors.js";

export class KubeAgentApi implements AgentApi {
  constructor(private readonly customObjects = customObjectsApi) {}

  private namespace(): string {
    return agentsNamespace();
  }

  async create(agent: AgentCr): Promise<{ name: string; created: boolean }> {
    const api = this.customObjects();
    const namespace = this.namespace();
    const name = agent.metadata?.name ?? "";
    const body = { apiVersion: AGENT_API_VERSION, kind: "Agent", ...agent };

    try {
      await api.createNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: PLURAL,
        body,
      });

      return { name, created: true };
    } catch (err) {
      if (isConflict(err)) {
        return { name, created: false };
      }
      throw err;
    }
  }

  async listByLabel(selector: string): Promise<AgentCr[]> {
    const api = this.customObjects();
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
