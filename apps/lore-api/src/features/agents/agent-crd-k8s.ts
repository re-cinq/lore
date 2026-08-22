// k8s apply/delete for the UI-authored catalog (ADR-031 D2, #698). IO shell (not in the
// coverage allowlist); the recipe→CRD mapping it applies is pure (agent-crd.ts). Uses the
// object-param CustomObjectsApi like the Floor's KubeCatalogApi: create, or replace with
// the live resourceVersion when the resource already exists.

import { agentsNamespace, loadKube } from "@re-cinq/lore-shared";
import { preserveUnownedFields, type CrdPair } from "./agent-crd.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const DEF_PLURAL = "agentdefinitions";
const STATION_PLURAL = "stations";

const namespace = (): string => agentsNamespace();

const statusOf = (err: unknown): number | undefined => {
  const e = err as { code?: number; response?: { statusCode?: number } };

  return e?.code ?? e?.response?.statusCode;
};
const isNotFound = (err: unknown): boolean => statusOf(err) === 404;
const isConflict = (err: unknown): boolean => statusOf(err) === 409;

async function api() {
  const { KubeConfig, CustomObjectsApi } =
    await import("@kubernetes/client-node");
  const kc = new KubeConfig();

  loadKube(kc);

  return kc.makeApiClient(CustomObjectsApi);
}

async function applyOne(
  plural: string,
  name: string,
  body: object,
): Promise<void> {
  const client = await api();
  const ns = namespace();

  try {
    await client.createNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: ns,
      plural,
      body,
    });
  } catch (err) {
    if (!isConflict(err)) {
      throw err;
    }
    const current = (await client.getNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: ns,
      plural,
      name,
    })) as { metadata?: { resourceVersion?: string } };
    // Replace-with-preservation (#1301): the editor's render wins the fields it
    // owns; everything else the live object carries (output.watch, helm labels
    // and annotations) survives the save instead of being amputated.
    const preserved = preserveUnownedFields(current, body) as {
      metadata?: Record<string, unknown>;
    };

    await client.replaceNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: ns,
      plural,
      name,
      body: {
        ...preserved,
        metadata: {
          ...(preserved.metadata ?? {}),
          resourceVersion: current.metadata?.resourceVersion,
        },
      },
    });
  }
}

async function deleteOne(plural: string, name: string): Promise<void> {
  const client = await api();

  try {
    await client.deleteNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: namespace(),
      plural,
      name,
    });
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

export async function applyAgentCrds(pair: CrdPair): Promise<void> {
  await applyOne(
    DEF_PLURAL,
    pair.agentDefinition.metadata?.name ?? "",
    pair.agentDefinition,
  );
  await applyOne(
    STATION_PLURAL,
    pair.station.metadata?.name ?? "",
    pair.station,
  );
}

export async function deleteAgentCrds(name: string): Promise<void> {
  await deleteOne(STATION_PLURAL, name);
  await deleteOne(DEF_PLURAL, name);
}
