// Live PruneCluster over @kubernetes/client-node — the thin IO seam behind the prune loop; decisions live in `decidePrune`. Lists/deletes the three kinds the chart's RBAC grants `delete` on.

import { agentsNamespace } from "@re-cinq/lore-shared";
import {
  AGENT_DEFINITION_PLURAL,
  AGENT_PLURAL,
  GROUP,
  STATION_PLURAL,
  VERSION,
} from "./crd.js";
import { customObjectsApi } from "./kube-clients.js";
import type { PrunableAgent, PrunableRecipe } from "../reap/decide-prune.js";
import type { PruneCluster } from "../reap/prune-loop.js";

interface CustomObjectItem {
  metadata?: { name?: string; creationTimestamp?: string };
  spec?: { stationRef?: string };
  status?: { phase?: string };
}

export class KubePruner implements PruneCluster {
  constructor(private readonly customObjects = customObjectsApi) {}

  private async list(plural: string): Promise<CustomObjectItem[]> {
    const res = (await this.customObjects().listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: agentsNamespace(),
      plural,
    })) as {
      items?: CustomObjectItem[];
      body?: { items?: CustomObjectItem[] };
    };

    return res.items ?? res.body?.items ?? [];
  }

  private async remove(plural: string, name: string): Promise<void> {
    await this.customObjects().deleteNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: agentsNamespace(),
      plural,
      name,
    });
  }

  async listAgents(): Promise<PrunableAgent[]> {
    return (await this.list(AGENT_PLURAL)).map((resource) => ({
      name: resource.metadata?.name ?? "",
      phase: resource.status?.phase,
      createdAt: createdAt(resource),
      stationRef: resource.spec?.stationRef,
    }));
  }

  async listStations(): Promise<PrunableRecipe[]> {
    return (await this.list(STATION_PLURAL)).map(toRecipe);
  }

  async listDefinitions(): Promise<PrunableRecipe[]> {
    return (await this.list(AGENT_DEFINITION_PLURAL)).map(toRecipe);
  }

  async deleteAgent(name: string): Promise<void> {
    await this.remove(AGENT_PLURAL, name);
  }

  async deleteStation(name: string): Promise<void> {
    await this.remove(STATION_PLURAL, name);
  }

  async deleteDefinition(name: string): Promise<void> {
    await this.remove(AGENT_DEFINITION_PLURAL, name);
  }
}

const toRecipe = (resource: CustomObjectItem): PrunableRecipe => ({
  name: resource.metadata?.name ?? "",
  createdAt: createdAt(resource),
});

/** An object reported without a creation stamp reads as brand new, so the age gate keeps it rather than deleting whatever the parse failed to understand. */
function createdAt(resource: CustomObjectItem): Date {
  const stamp = resource.metadata?.creationTimestamp;
  const parsed = stamp ? new Date(stamp) : null;

  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}
