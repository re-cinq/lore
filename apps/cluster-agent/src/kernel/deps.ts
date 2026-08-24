// Binding the routes to the real Kubernetes clients.
//
// Lazy + memoized: constructing a client loads a kubeconfig, and `buildServer`
// must be able to describe the service without a cluster present (tests do
// exactly that).

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { KubeConfig, CustomObjectsApi } from "@kubernetes/client-node";
import {
  agentsNamespace,
  loadKube,
  preserveUnownedFields,
} from "@re-cinq/lore-shared";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { KubeAgentApi } from "./kube-agent-api.js";
import { KubePodLogs } from "./kube-pod-logs.js";
import {
  KubeTokenProvisioner,
  GithubTokenMinter,
  KubeSecretKeyWriter,
  KubeCatalogApi,
} from "./kube-token-provisioner.js";
import type { ClusterDeps } from "../delivery/routes/cluster.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";

let singleton: ClusterDeps | undefined;

function customObjects(): CustomObjectsApi {
  const kc = new KubeConfig();

  loadKube(kc);

  return kc.makeApiClient(CustomObjectsApi);
}

export function clusterDeps(): ClusterDeps {
  if (singleton) {
    return singleton;
  }
  const api = new KubeAgentApi();
  const pods = new KubePodLogs();
  const catalog = new KubeCatalogApi();
  const tokens = new KubeTokenProvisioner(
    new GithubTokenMinter(new PlatformGitHub(process.env)),
    new KubeSecretKeyWriter(),
    catalog,
  );

  singleton = {
    agents: {
      create: (cr) => api.create(cr),
      get: async (name) => {
        try {
          return (await customObjects().getNamespacedCustomObject({
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
        const page = (await customObjects().listNamespacedCustomObject({
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
        await customObjects()
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
      // The read and the replace stay together, on this side of the network.
      patchStatus: async (name, patch) => {
        const co = customObjects();
        const args = {
          group: GROUP,
          version: VERSION,
          namespace: agentsNamespace(),
          plural: PLURAL,
          name,
        };
        const current = (await co.getNamespacedCustomObjectStatus(args)) as {
          status?: Record<string, unknown>;
          [k: string]: unknown;
        };

        await co.replaceNamespacedCustomObjectStatus({
          ...args,
          body: { ...current, status: { ...current.status, ...patch } },
        });
      },
    },
    pods: {
      agentInfo: (name) => pods.agentInfo(name),
      podsForJob: (job) => pods.podsForJob(job),
      podLog: (pod, tail) => pods.podLog(pod, tail),
    },
    tokens: {
      provision: (spec) => tokens.provision(spec),
      cleanup: (taskId) => tokens.cleanup(taskId),
    },
    catalog: {
      // create → 409 → get-for-resourceVersion → replace, with the live
      // object's unrendered fields carried across. One call, one side.
      applyPair: async ({ agentDefinition, station }) => {
        await catalog.applyAgentDefinition(
          mergeOntoLive(
            await catalog.getAgentDefinition(agentDefinition.metadata!.name!),
            agentDefinition,
          ),
        );
        await catalog.applyStation(
          mergeOntoLive(
            await catalog.getStation(station.metadata!.name!),
            station,
          ),
        );
      },
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

function mergeOntoLive<T extends AgentDefinition | Station>(
  live: unknown,
  desired: T,
): T {
  return live ? preserveUnownedFields(live, desired) : desired;
}

/** The apiserver's status code, wherever this client version happens to put it. */
function statusOf(err: unknown): number | undefined {
  const e = err as {
    code?: number;
    statusCode?: number;
    response?: { statusCode?: number };
  };

  return e?.code ?? e?.statusCode ?? e?.response?.statusCode;
}

function isNotFound(err: unknown): boolean {
  return statusOf(err) === 404;
}

/** Name the verb and the status, because "Forbidden" alone does not say which
 *  Role is missing which rule. */
function describeK8sError(verb: string, name: string, err: unknown): string {
  const status = statusOf(err);
  const detail =
    status === 403 ? " — the cluster-agent Role is missing this rule" : "";

  return `${verb} agents/${name} failed with ${status ?? "no status"}${detail}: ${(err as Error).message}`;
}
