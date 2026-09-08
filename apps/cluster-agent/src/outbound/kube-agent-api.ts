// Live AgentApi over @kubernetes/client-node — the thin IO seam behind the AgentApi port (mapping/decision logic lives in agent-backend.ts); creates/lists Agent CRs, a 409 maps to created:false.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { agentsNamespace } from "@re-cinq/lore-shared";
import type { AgentApi } from "@re-cinq/lore-shared";
import {
  AGENT_API_VERSION,
  GROUP,
  VERSION,
  AGENT_PLURAL as PLURAL,
} from "../domain/crd.js";
import { customObjectsApi } from "./kube-clients.js";
import { isConflict } from "../lib/k8s-errors.js";

export class KubeAgentApi implements AgentApi {
  constructor(private readonly customObjects = customObjectsApi) {}

  private namespace(): string {
    return agentsNamespace();
  }

  async create(agent: AgentCr): Promise<{ name: string; created: boolean }> {
    const name = agent.metadata?.name ?? "";

    try {
      await this.customObjects().createNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace(),
        plural: PLURAL,
        body: { apiVersion: AGENT_API_VERSION, kind: "Agent", ...agent },
      });

      return { name, created: true };
    } catch (err) {
      // A 409 means this CR already exists — the claim was replayed, so the caller is told nothing was created rather than being handed an error it would have to classify.
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
