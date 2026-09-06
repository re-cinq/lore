// One Kubernetes client per process, not one per call — `loadKube` reads the kubeconfig synchronously and eight sites did that per operation; memoized lazily so `buildServer` describes the service with no cluster present.

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
