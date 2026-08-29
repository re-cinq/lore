/**
 * One Kubernetes client per process, not one per call.
 *
 * `loadKube` reads the kubeconfig — or, in-cluster, the service-account files —
 * synchronously, and eight sites were doing that on every operation: a single
 * claim launch ran it six times over, and every read route ran it once per
 * request. The config does not change while the pod lives, and the client's own
 * `FileAuth` re-reads the projected token per request, so caching the client
 * does not stale a rotated credential.
 *
 * Memoized lazily rather than at import, because `buildServer` must be able to
 * describe the service with no cluster present — the tests do exactly that.
 */

import {
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
} from "@kubernetes/client-node";
import { loadKube } from "@re-cinq/lore-shared";

let config: KubeConfig | undefined;
let core: CoreV1Api | undefined;
let customObjects: CustomObjectsApi | undefined;

export function kubeConfig(): KubeConfig {
  if (!config) {
    config = new KubeConfig();
    loadKube(config);
  }

  return config;
}

export function coreApi(): CoreV1Api {
  return (core ??= kubeConfig().makeApiClient(CoreV1Api));
}

export function customObjectsApi(): CustomObjectsApi {
  return (customObjects ??= kubeConfig().makeApiClient(CustomObjectsApi));
}
