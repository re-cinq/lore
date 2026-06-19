import * as k8s from "@kubernetes/client-node";
import {
  GROUP,
  VERSION,
  AGENTS_PLURAL,
  STATIONS_PLURAL,
  AGENTDEFS_PLURAL,
  type Agent,
  type AgentDefinition,
  type AgentStatus,
  type Station,
} from "./cr-types.js";
import type { JobOutcome, ReconcileDeps } from "./reconcile.js";

/**
 * The real, cluster-backed implementation of ReconcileDeps (ADR-031). All k8s
 * client calls live here so reconcile.ts stays pure + unit-testable. Call
 * signatures mirror the proven LoreTask controller (@kubernetes/client-node v1.x,
 * object-param style).
 */

const AGENT_CONTAINER = "agent";

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; response?: { statusCode?: number } };
  return e?.code === 404 || e?.response?.statusCode === 404;
}

function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: number; response?: { statusCode?: number }; message?: string };
  return e?.code === 409 || e?.response?.statusCode === 409 || String(e?.message).includes("already exists");
}

export function makeK8sDeps(kc: k8s.KubeConfig, namespace: string): ReconcileDeps {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
  const batchApi = kc.makeApiClient(k8s.BatchV1Api);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);

  async function getCustom<T>(plural: string, name: string): Promise<T | null> {
    try {
      return (await customApi.getNamespacedCustomObject({
        group: GROUP, version: VERSION, namespace, plural, name,
      })) as unknown as T;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async function readPodLogs(jobName: string): Promise<string> {
    try {
      const pods = await coreApi.listNamespacedPod({ namespace, labelSelector: `job-name=${jobName}` });
      const podName = pods.items[0]?.metadata?.name;
      if (!podName) return "";
      const logs = await coreApi.readNamespacedPodLog({
        name: podName, namespace, container: AGENT_CONTAINER, tailLines: 1000,
      });
      return typeof logs === "string" ? logs : String(logs);
    } catch {
      return "";
    }
  }

  return {
    getStation: (name) => getCustom<Station>(STATIONS_PLURAL, name),
    getAgentDefinition: (name) => getCustom<AgentDefinition>(AGENTDEFS_PLURAL, name),

    async createJob(job) {
      try {
        await batchApi.createNamespacedJob({ namespace, body: job });
      } catch (err) {
        if (!isAlreadyExists(err)) throw err; // re-reconcile of the same run is benign
      }
    },

    async jobOutcome(jobName): Promise<JobOutcome | null> {
      let job: k8s.V1Job;
      try {
        job = await batchApi.readNamespacedJob({ name: jobName, namespace });
      } catch (err) {
        if (isNotFound(err)) return null; // TTL-deleted; nothing to read
        throw err;
      }
      const conditions = job.status?.conditions ?? [];
      const complete = conditions.find((c) => c.type === "Complete" && c.status === "True");
      const failed = conditions.find((c) => c.type === "Failed" && c.status === "True");
      if (complete) return { state: "succeeded", exitCode: 0, output: (await readPodLogs(jobName)).slice(-5000) };
      if (failed) {
        const reason = failed.message || failed.reason || "Job failed";
        return { state: "failed", exitCode: 1, reason, output: (await readPodLogs(jobName)).slice(-5000) };
      }
      return { state: "running" };
    },

    async patchAgentStatus(name, status: AgentStatus) {
      // Read-modify-write on the status subresource. The watch and the 15s poll can
      // both write at once → a 409 Conflict; re-read the latest and retry a few times.
      for (let attempt = 0; ; attempt++) {
        const current = (await customApi.getNamespacedCustomObjectStatus({
          group: GROUP, version: VERSION, namespace, plural: AGENTS_PLURAL, name,
        })) as unknown as Agent;
        const merged = { ...current, status: { ...(current.status ?? {}), ...status } };
        try {
          await customApi.replaceNamespacedCustomObjectStatus({
            group: GROUP, version: VERSION, namespace, plural: AGENTS_PLURAL, name, body: merged,
          });
          return;
        } catch (err) {
          const conflict = (err as { code?: number; response?: { statusCode?: number } });
          if ((conflict?.code === 409 || conflict?.response?.statusCode === 409) && attempt < 4) continue;
          throw err;
        }
      }
    },

    async listAgentsForStation(stationName) {
      const res = (await customApi.listNamespacedCustomObject({
        group: GROUP, version: VERSION, namespace, plural: AGENTS_PLURAL,
      })) as unknown as { items: Agent[] };
      return (res.items ?? []).filter((a) => a.spec?.stationRef === stationName);
    },

    async deleteAgent(name) {
      try {
        await customApi.deleteNamespacedCustomObject({
          group: GROUP, version: VERSION, namespace, plural: AGENTS_PLURAL, name,
        });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },

    now: () => new Date().toISOString(),
  };
}
