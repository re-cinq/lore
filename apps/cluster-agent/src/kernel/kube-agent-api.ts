// Live AgentApi over @kubernetes/client-node (lazily imported, as in k8s-loretask.ts).
// The thin IO seam behind the AgentApi port — the mapping/decision logic it backs
// lives in agent-backend.ts and is covered there. Creates/lists `Agent` CRs in the
// ai-agents namespace (agents.re-cinq.com); a 409 maps to created:false.

import {
  GROUP,
  VERSION,
  type Agent as AgentCr,
} from "@re-cinq/agent-contracts";
import { agentsNamespace, loadKube } from "@re-cinq/lore-shared";
import type { AgentApi } from "@re-cinq/lore-shared";
// Type-only, so the runtime import below stays lazy.
import type { CustomObjectsApi } from "@kubernetes/client-node";
import { isConflict } from "./k8s-errors.js";

const PLURAL = "agents";

/** How this adapter reaches the apiserver. Injectable so the error mapping
 *  below — which decides whether a claim produced a pod — can be driven without
 *  a cluster. */
export type CustomObjectsFactory = () => Promise<CustomObjectsApi>;

const kubeCustomObjects: CustomObjectsFactory = async () => {
  const { KubeConfig, CustomObjectsApi: Api } =
    await import("@kubernetes/client-node");
  const kc = new KubeConfig();

  loadKube(kc);

  return kc.makeApiClient(Api);
};

export class KubeAgentApi implements AgentApi {
  constructor(
    private readonly customObjects: CustomObjectsFactory = kubeCustomObjects,
  ) {}

  private namespace(): string {
    return agentsNamespace();
  }

  async create(agent: AgentCr): Promise<{ name: string; created: boolean }> {
    const api = await this.customObjects();
    const namespace = this.namespace();
    const name = agent.metadata?.name ?? "";
    const body = { apiVersion: `${GROUP}/${VERSION}`, kind: "Agent", ...agent };

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
