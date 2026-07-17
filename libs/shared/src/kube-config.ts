/**
 * Where a Lore process gets its Kubernetes credentials.
 *
 * In the cluster a pod reads its service account, but a developer running
 * `npm start` on a laptop has none — they drive minikube through the kubeconfig in
 * their user folder instead. Both the Floor (Agent CR dispatch, token provisioning,
 * pod logs, the CR watch) and lore-api (the `/agents` catalog writes) need this, so
 * the rule lives here rather than twice.
 *
 * `kubeConfigSource` is the pure decision; `loadKube` is the thin IO shell every
 * `@kubernetes/client-node` construction site calls. The loader is typed
 * structurally so `shared` keeps its zero `@kubernetes/client-node` dependency —
 * the real `KubeConfig` satisfies it (same trick as k8s-errors.ts, which never
 * imports the client either).
 */

export type KubeConfigSource =
  { kind: "cluster" } | { kind: "file"; path: string } | { kind: "default" };

/** The subset of `@kubernetes/client-node`'s KubeConfig that {@link loadKube} drives. */
export interface KubeConfigLoader {
  loadFromCluster(): void;
  loadFromFile(file: string): void;
  loadFromDefault(): void;
}

/**
 * Precedence: in-cluster pod service account → the explicit `LORE_KUBECONFIG`
 * override → the ambient default (`KUBECONFIG`, else `~/.kube/config`). In-cluster
 * wins so a stray `LORE_KUBECONFIG` in a pod env cannot repoint a deployed process
 * at someone's laptop cluster.
 */
export function kubeConfigSource(
  env: NodeJS.ProcessEnv = process.env,
): KubeConfigSource {
  if (env.KUBERNETES_SERVICE_HOST) {
    return { kind: "cluster" };
  }

  if (env.LORE_KUBECONFIG) {
    return { kind: "file", path: env.LORE_KUBECONFIG };
  }

  return { kind: "default" };
}

/** Load cluster credentials into `kc` per {@link kubeConfigSource}. */
export function loadKube(
  kc: KubeConfigLoader,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const source = kubeConfigSource(env);

  if (source.kind === "cluster") {
    kc.loadFromCluster();

    return;
  }

  if (source.kind === "file") {
    kc.loadFromFile(source.path);

    return;
  }

  kc.loadFromDefault();
}
