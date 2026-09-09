// The cluster's catalog surface: the Station and AgentDefinition CRs a run resolves.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { agentsNamespace } from "@re-cinq/lore-shared";
import {
  GROUP,
  VERSION,
  AGENT_DEFINITION_PLURAL as DEF_PLURAL,
  STATION_PLURAL,
} from "../domain/crd.js";
import { isConflict, isMissing } from "../lib/k8s-errors.js";
import { customObjectsApi } from "./kube-clients.js";
import type { CatalogApi } from "./kube-token-provisioner.js";

/** A conflict means it already exists, so this replaces it — carrying the LIVE resourceVersion, without which the API rejects the write. */
async function replaceExisting(
  api: ReturnType<typeof customObjectsApi>,
  namespace: string,
  target: { plural: string; name: string; body: object },
): Promise<void> {
  const { plural, name, body } = target;
  const resourceVersion = await liveResourceVersion(api, namespace, {
    plural,
    name,
  });
  const meta = (body as { metadata?: Record<string, unknown> }).metadata ?? {};

  await api.replaceNamespacedCustomObject({
    group: GROUP,
    version: VERSION,
    namespace,
    plural,
    name,
    body: { ...body, metadata: { ...meta, resourceVersion } },
  });
}

// The version the API currently holds. A replace without it is rejected — Kubernetes uses it to refuse a write based on a copy someone else has already moved on from.
async function liveResourceVersion(
  api: ReturnType<typeof customObjectsApi>,
  namespace: string,
  target: { plural: string; name: string },
): Promise<string | undefined> {
  const current = (await api.getNamespacedCustomObject({
    group: GROUP,
    version: VERSION,
    namespace,
    plural: target.plural,
    name: target.name,
  })) as { metadata?: { resourceVersion?: string } };

  return current.metadata?.resourceVersion;
}

export class KubeCatalogApi implements CatalogApi {
  constructor(private readonly namespace = agentsNamespace()) {}

  getAgentDefinition(name: string): Promise<AgentDefinition | null> {
    return this.get<AgentDefinition>(DEF_PLURAL, name);
  }
  getStation(name: string): Promise<Station | null> {
    return this.get<Station>(STATION_PLURAL, name);
  }
  applyAgentDefinition(def: AgentDefinition): Promise<void> {
    return this.apply(DEF_PLURAL, def.metadata?.name ?? "", def);
  }
  applyStation(station: Station): Promise<void> {
    return this.apply(STATION_PLURAL, station.metadata?.name ?? "", station);
  }
  deleteAgentDefinition(name: string): Promise<void> {
    return this.del(DEF_PLURAL, name);
  }
  deleteStation(name: string): Promise<void> {
    return this.del(STATION_PLURAL, name);
  }

  private async get<T>(plural: string, name: string): Promise<T | null> {
    const api = customObjectsApi();

    try {
      return (await api.getNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace,
        plural,
        name,
      })) as T;
    } catch (err) {
      if (isMissing(err)) {
        return null;
      }
      throw err;
    }
  }

  // A 409 means the object already exists, so the create becomes a replace. Anything else is rethrown — this path exists to make the write idempotent, not to swallow API errors.
  private async replaceOnConflict(
    err: unknown,
    api: ReturnType<typeof customObjectsApi>,
    target: { plural: string; name: string; body: object },
  ): Promise<void> {
    if (!isConflict(err)) {
      throw err;
    }
    await replaceExisting(api, this.namespace, target);
  }

  // Create, or replace (carrying the live resourceVersion) when it already exists.
  private async apply(
    plural: string,
    name: string,
    body: object,
  ): Promise<void> {
    const api = customObjectsApi();

    try {
      await api.createNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace,
        plural,
        body,
      });
    } catch (err) {
      await this.replaceOnConflict(err, api, { plural, name, body });
    }
  }

  private async del(plural: string, name: string): Promise<void> {
    const api = customObjectsApi();

    try {
      await api.deleteNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: this.namespace,
        plural,
        name,
      });
    } catch (err) {
      if (!isMissing(err)) {
        throw err;
      }
    }
  }
}
