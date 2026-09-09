/** Where Lore processes get Kubernetes credentials: pod service account (cluster) or kubeconfig (laptop dev); shared to prevent duplication. */

export type KubeConfigSource =
  { kind: "cluster" } | { kind: "file"; path: string } | { kind: "default" };

/** The subset of `@kubernetes/client-node`'s KubeConfig that {@link loadKube} drives. */
export interface KubeConfigLoader {
  loadFromCluster(): void;
  loadFromFile(file: string): void;
  loadFromDefault(): void;
}

/** Kube config precedence: in-cluster pod → LORE_KUBECONFIG override → KUBECONFIG/~/.kube/config (in-cluster wins, prevents laptop redirect). */
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

/** Namespace Agent CRs live in; centralized to prevent drift across eight construction sites; pure, no k8s client weight. */
export function agentsNamespace(env: NodeJS.ProcessEnv = process.env): string {
  return env.LORE_AGENTS_NAMESPACE ?? "ai-agents";
}
