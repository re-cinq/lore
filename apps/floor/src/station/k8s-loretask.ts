import { defaultStationName } from "@re-cinq/lore-shared";
import type { K8sPort, LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";

const GROUP = "lore.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "loretasks";

/**
 * K8s Station backend (ADR-028) — creates a LoreTask CR via @kubernetes/client-node
 * (lazily imported, as in worker.ts). Async backend: `launch` returns once the CR
 * exists and OMITS `completion`; the loretask-watcher resolves completion from the
 * CR status later. The 409-already-exists case maps to launched:false. Also
 * satisfies the legacy K8sPort (`createLoreTask`), still used by callers that
 * create CRs directly.
 */
export class K8sLoreTaskClient implements K8sPort, StationBackend {
  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    const { name, created } = await this.createLoreTask(spec);
    return { ref: name, launched: created };
  }

  /** True while the task's LoreTask CR exists and has not reached a terminal
   *  phase. A 404 (CR garbage-collected) reads as not-active → orphaned; any
   *  other API error returns `true` so the reaper falls back to its age window
   *  rather than killing a round on a transient kube fault. */
  async isActive(taskId: string): Promise<boolean> {
    try {
      const { KubeConfig, CustomObjectsApi } = await import("@kubernetes/client-node");
      const kc = new KubeConfig();
      kc.loadFromCluster();
      const k8sApi = kc.makeApiClient(CustomObjectsApi);
      const namespace = process.env.NAMESPACE ?? "lore-floor";
      const res = (await k8sApi.getNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: PLURAL,
        name: defaultStationName(taskId),
      })) as { body?: { status?: { phase?: string } }; status?: { phase?: string } };
      const phase = res?.body?.status?.phase ?? res?.status?.phase;
      return !(typeof phase === "string" && /succeeded|failed|completed/i.test(phase));
    } catch (err) {
      const e = err as { code?: number; response?: { statusCode?: number } };
      if (e?.code === 404 || e?.response?.statusCode === 404) return false;
      return true;
    }
  }

  async createLoreTask(
    spec: LoreTaskSpec,
    opts?: { namespace?: string },
  ): Promise<{ name: string; created: boolean }> {
    const { KubeConfig, CustomObjectsApi } = await import("@kubernetes/client-node");
    const kc = new KubeConfig();
    kc.loadFromCluster();
    const k8sApi = kc.makeApiClient(CustomObjectsApi);

    const namespace = opts?.namespace ?? process.env.NAMESPACE ?? "lore-floor";
    const name = spec.name ?? defaultStationName(spec.taskId);

    const cr = {
      apiVersion: `${GROUP}/${VERSION}`,
      kind: "LoreTask",
      metadata: {
        name,
        namespace,
        labels: {
          "lore.re-cinq.com/task-id": spec.taskId,
          "lore.re-cinq.com/task-type": spec.taskType,
          ...(spec.extraLabels ?? {}),
        },
      },
      spec: {
        taskId: spec.taskId,
        taskType: spec.taskType,
        description: spec.description,
        prompt: spec.prompt,
        targetRepo: spec.targetRepo,
        branch: spec.branch,
        model: spec.model ?? "claude-sonnet-4-6",
        timeoutMinutes: spec.timeoutMinutes ?? 30,
        ...(spec.prNumber !== undefined ? { prNumber: spec.prNumber } : {}),
        ...(spec.darkFactory ? { darkFactory: spec.darkFactory } : {}),
        ...(spec.image ? { image: spec.image } : {}),
      },
    };

    try {
      await k8sApi.createNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, body: cr });
      return { name, created: true };
    } catch (err) {
      const e = err as { code?: number; response?: { statusCode?: number }; message?: string };
      const is409 = e?.code === 409 || e?.response?.statusCode === 409 || String(e?.message).includes("already exists");
      if (is409) return { name, created: false };
      throw err;
    }
  }
}
