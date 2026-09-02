// Binding the routes to the real Kubernetes clients.
//
// Lazy + memoized: constructing a client loads a kubeconfig, and `buildServer`
// must be able to describe the service without a cluster present (tests do
// exactly that).

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { agentsNamespace } from "@re-cinq/lore-shared";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { KubePodLogs } from "./kube-pod-logs.js";
import {
  KubeTokenProvisioner,
  GithubTokenMinter,
  KubeSecretKeyWriter,
  KubeCatalogApi,
} from "./kube-token-provisioner.js";
import type { ClusterDeps } from "../delivery/routes/cluster.js";
import { isNotFound, describeK8sError } from "./k8s-errors.js";
import { GROUP, VERSION, AGENT_PLURAL as PLURAL } from "./crd.js";
import { customObjectsApi } from "./kube-clients.js";
import { applyCatalogPair } from "./paired-writes.js";

let singleton: ClusterDeps | undefined;
let provisionerSingleton: KubeTokenProvisioner | undefined;

/** The one per-task token provisioner. Every launch is a claim now, so the
 *  claim loop is its only caller — kept a shared singleton because the Secret
 *  writer it holds merges into `agent-secrets` and must not race itself. */
export function kubeTokenProvisioner(): KubeTokenProvisioner {
  if (!provisionerSingleton) {
    provisionerSingleton = new KubeTokenProvisioner(
      new GithubTokenMinter(new PlatformGitHub(process.env)),
      new KubeSecretKeyWriter(),
      new KubeCatalogApi(),
    );
  }

  return provisionerSingleton;
}

export function clusterDeps(): ClusterDeps {
  if (singleton) {
    return singleton;
  }
  const pods = new KubePodLogs();
  const catalog = new KubeCatalogApi();
  const tokens = kubeTokenProvisioner();

  singleton = {
    agents: {
      get: async (name) => {
        try {
          return (await customObjectsApi().getNamespacedCustomObject({
            group: GROUP,
            version: VERSION,
            namespace: agentsNamespace(),
            plural: PLURAL,
            name,
          })) as never;
        } catch (err) {
          // Only a 404 means "no such CR". An RBAC denial, a 5xx or a dead
          // socket must NOT be laundered into `found: false` — that is the
          // shape a caller reads as "already gone" and stops asking about,
          // which is exactly how the Floor's missing `delete` verb stayed
          // invisible for forty days.
          enforceTrue(
            isNotFound(err),
            Error,
            describeK8sError("get", name, err),
          );

          return null;
        }
      },
      list: async (opts) => {
        const page = (await customObjectsApi().listNamespacedCustomObject({
          group: GROUP,
          version: VERSION,
          namespace: agentsNamespace(),
          plural: PLURAL,
          limit: opts.limit,
          _continue: opts.continue,
          ...(opts.labelSelector ? { labelSelector: opts.labelSelector } : {}),
        })) as {
          items?: never[];
          metadata?: { continue?: string; _continue?: string };
        };

        return {
          items: page.items ?? [],
          continueToken: page.metadata?._continue ?? page.metadata?.continue,
        };
      },
      remove: async (name) => {
        await customObjectsApi()
          .deleteNamespacedCustomObject({
            group: GROUP,
            version: VERSION,
            namespace: agentsNamespace(),
            plural: PLURAL,
            name,
          })
          .catch((err) => {
            // A delete that lost a race is a success — the CR is gone either
            // way. Anything else is reported: the caller swallows prune
            // failures by design, so this log is the only place a denied or
            // failing delete can still be seen.
            enforceTrue(
              isNotFound(err),
              Error,
              describeK8sError("delete", name, err),
            );
          });
      },
    },
    pods: {
      agentInfo: (name) => pods.agentInfo(name),
      podsForJob: (job) => pods.podsForJob(job),
      podLog: (pod, tail) => pods.podLog(pod, tail),
      listRunning: () => pods.listRunning(),
    },
    tokens: {
      cleanup: (taskId) => tokens.cleanup(taskId),
    },
    catalog: {
      // create → 409 → get-for-resourceVersion → replace, with the live
      // object's unrendered fields carried across. One call, one side.
      //
      applyPair: (pair) => applyCatalogPair(catalog, pair),
      // Station first: the AgentDefinition is what a dispatch looks up, so
      // removing it last never leaves a recipe pointing at a missing station.
      deletePair: async (name) => {
        await catalog.deleteStation(name);
        await catalog.deleteAgentDefinition(name);
      },
    },
  };

  return singleton;
}
