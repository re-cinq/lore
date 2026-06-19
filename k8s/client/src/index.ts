import * as k8s from "@kubernetes/client-node";
import { GROUP, VERSION, AGENTS_PLURAL, DEFAULT_NAMESPACE, type Agent } from "./types.js";

export * from "./types.js";

/** Load in-cluster config when deployed, else the local kubeconfig (kind/dev). */
export function loadConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }
  return kc;
}

const ns = (n?: string) => n ?? process.env.NAMESPACE ?? DEFAULT_NAMESPACE;
const api = (kc: k8s.KubeConfig) => kc.makeApiClient(k8s.CustomObjectsApi);

export interface LaunchAgentParams {
  station: string;
  namespace?: string;
  taskId?: string;
  targetRepo?: string;
  branch?: string;
  parameters?: Record<string, string>;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  /** Name prefix Kubernetes appends a random suffix to. Defaults to "<station>-run-". */
  generateName?: string;
}

export interface LaunchedAgent {
  /** The run id — the Agent's metadata.name. */
  name: string;
  uid: string;
}

/** Create an Agent CR (start a run). Returns its server-assigned name (the run id) + uid. */
export async function launchAgent(
  params: LaunchAgentParams,
  kc: k8s.KubeConfig = loadConfig(),
): Promise<LaunchedAgent> {
  const namespace = ns(params.namespace);
  const body: Agent = {
    apiVersion: `${GROUP}/${VERSION}`,
    kind: "Agent",
    metadata: {
      generateName: params.generateName ?? `${params.station}-run-`,
      ...(params.labels ? { labels: params.labels } : {}),
      ...(params.annotations ? { annotations: params.annotations } : {}),
    },
    spec: {
      stationRef: params.station,
      ...(params.taskId ? { taskId: params.taskId } : {}),
      ...(params.targetRepo ? { targetRepo: params.targetRepo } : {}),
      ...(params.branch ? { branch: params.branch } : {}),
      ...(params.parameters ? { parameters: params.parameters } : {}),
    },
  };
  const created = (await api(kc).createNamespacedCustomObject({
    group: GROUP, version: VERSION, namespace, plural: AGENTS_PLURAL, body,
  })) as unknown as Agent;
  return { name: created.metadata?.name ?? "", uid: created.metadata?.uid ?? "" };
}

/** Fetch one Agent by name (its current status). */
export async function getAgent(
  name: string,
  opts: { namespace?: string } = {},
  kc: k8s.KubeConfig = loadConfig(),
): Promise<Agent> {
  return (await api(kc).getNamespacedCustomObject({
    group: GROUP, version: VERSION, namespace: ns(opts.namespace), plural: AGENTS_PLURAL, name,
  })) as unknown as Agent;
}

/** List Agents matching your own label selector (custom-metadata lookup). */
export async function findAgents(
  opts: { labelSelector?: string; namespace?: string } = {},
  kc: k8s.KubeConfig = loadConfig(),
): Promise<Agent[]> {
  const res = (await api(kc).listNamespacedCustomObject({
    group: GROUP, version: VERSION, namespace: ns(opts.namespace), plural: AGENTS_PLURAL,
    ...(opts.labelSelector ? { labelSelector: opts.labelSelector } : {}),
  })) as unknown as { items: Agent[] };
  return res.items ?? [];
}

const TERMINAL = new Set(["Succeeded", "Failed"]);

/** Poll an Agent by name until it reaches a terminal phase; calls onUpdate on each change. */
export async function watchAgent(
  name: string,
  onUpdate: (agent: Agent) => void = () => {},
  opts: { namespace?: string; intervalMs?: number; timeoutMs?: number } = {},
  kc: k8s.KubeConfig = loadConfig(),
): Promise<Agent> {
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 60 * 60_000);
  let lastPhase: string | undefined;
  for (;;) {
    const agent = await getAgent(name, { namespace: opts.namespace }, kc);
    const phase = agent.status?.phase;
    if (phase !== lastPhase) {
      lastPhase = phase;
      onUpdate(agent);
    }
    if (phase && TERMINAL.has(phase)) return agent;
    if (Date.now() > deadline) throw new Error(`watchAgent timed out waiting for ${name}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
