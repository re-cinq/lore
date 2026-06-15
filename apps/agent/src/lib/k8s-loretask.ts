import type { K8sPort, LoreTaskSpec } from "@re-cinq/lore-shared";

const GROUP = "lore.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "loretasks";

/**
 * K8sPort impl for the agent — creates a LoreTask CR via @kubernetes/client-node
 * (lazily imported, as in worker.ts). Consolidates the three identical-shaped CR
 * bodies previously copy-pasted in worker.ts / spec-task-executor.ts /
 * loretask-watcher.ts; the 409-already-exists case maps to created:false.
 */
export class K8sLoreTaskClient implements K8sPort {
  async createLoreTask(
    spec: LoreTaskSpec,
    opts?: { namespace?: string },
  ): Promise<{ name: string; created: boolean }> {
    const { KubeConfig, CustomObjectsApi } = await import("@kubernetes/client-node");
    const kc = new KubeConfig();
    kc.loadFromCluster();
    const k8sApi = kc.makeApiClient(CustomObjectsApi);

    const namespace = opts?.namespace ?? process.env.NAMESPACE ?? "lore-agent";
    const name = spec.name ?? `loretask-${spec.taskId.substring(0, 8)}`;

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
