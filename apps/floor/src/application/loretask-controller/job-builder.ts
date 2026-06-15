import type * as k8s from "@kubernetes/client-node";
import { RELAY_SCRIPT } from "@re-cinq/lore-runner";

/**
 * Builds the Kubernetes Job for a LoreTask (ADR-025, sidecar model).
 *
 * Default (no BYO image): a single kernel container — today's behavior, byte-for-
 * byte. When `spec.image` names a Bring-Your-Own toolchain image, the Job becomes
 * a two-container pod: the kernel stays on our image (`KERNEL_IMAGE`) and the BYO
 * image runs as a **native sidecar** (an initContainer with `restartPolicy:
 * Always`) executing the relay loop. Both mount a shared `workspace` emptyDir, so
 * the kernel clones/edits there and the toolchain validates the same tree; the
 * kernel drives toolchain commands over the relay (`LORE_TOOLCHAIN_RELAY`).
 *
 * Pure function — the controller passes the result to `createNamespacedJob`.
 */

export const KERNEL_IMAGE = "ghcr.io/re-cinq/lore-claude-runner:latest";
const WORKSPACE_VOLUME = "workspace";
const WORKSPACE_PATH = "/workspace";
const RELAY_DIR = "/workspace/.lore/relay";
const RELAY_WORKDIR = "/workspace/repo";
// Writable HOME on the shared volume — the pod runs non-root (uid 1000) and the
// BYO image's default HOME (often /root) isn't writable, so toolchain caches
// (npm ~/.npm, go $HOME/.cache, cargo ~/.cargo) would fail on first run.
const TOOLCHAIN_HOME = "/workspace/.home";

export interface LoreTaskJobInput {
  spec: {
    taskId: string;
    taskType?: string;
    targetRepo: string;
    prompt: string;
    description?: string;
    branch: string;
    model?: string;
    timeoutMinutes?: number;
    prNumber?: number;
    image?: string;
    darkFactory?: { workflowName: string; baseBranch: string };
  };
  namespace: string;
  tokenSecretName: string;
  ingestUrl: string;
}

function kernelEnv(
  input: LoreTaskJobInput,
  byo: boolean,
): k8s.V1EnvVar[] {
  const { spec } = input;
  const env: k8s.V1EnvVar[] = [
    { name: "TARGET_REPO", value: spec.targetRepo },
    { name: "BRANCH_NAME", value: spec.branch },
    { name: "TASK_PROMPT", value: spec.prompt },
    { name: "MODEL", value: spec.model || "claude-sonnet-4-6" },
    { name: "TASK_TYPE", value: spec.taskType || "implementation" },
    { name: "PR_NUMBER", value: String(spec.prNumber || "") },
    {
      name: "LORE_DARK_FACTORY_WORKFLOW",
      value: spec.darkFactory?.workflowName ?? "",
    },
    { name: "BASE_BRANCH", value: spec.darkFactory?.baseBranch ?? "" },
    { name: "LORE_TASK_ID", value: spec.taskId },
    { name: "TASK_DESCRIPTION", value: spec.description ?? spec.prompt },
    {
      name: "ANTHROPIC_API_KEY",
      valueFrom: {
        secretKeyRef: { name: "lore-anthropic-key", key: "anthropic-api-key" },
      },
    },
    {
      name: "GITHUB_TOKEN",
      valueFrom: {
        secretKeyRef: { name: input.tokenSecretName, key: "github-token" },
      },
    },
    { name: "LORE_API_URL", value: input.ingestUrl },
    {
      name: "LORE_INGEST_TOKEN",
      valueFrom: {
        secretKeyRef: { name: "lore-ingest-token", key: "token", optional: true },
      },
    },
  ];
  // BYO sidecar: tell the kernel where to dispatch toolchain commands.
  if (byo) env.push({ name: "LORE_TOOLCHAIN_RELAY", value: RELAY_DIR });
  return env;
}

export function buildLoreTaskJob(input: LoreTaskJobInput): k8s.V1Job {
  const { spec, namespace } = input;
  const taskIdShort = spec.taskId.substring(0, 8);
  const jobName = `loretask-job-${taskIdShort}`;
  const toolchainImage =
    spec.image && spec.image !== KERNEL_IMAGE ? spec.image : undefined;
  const byo = toolchainImage !== undefined;

  const kernelContainer: k8s.V1Container = {
    name: "claude-runner",
    image: KERNEL_IMAGE,
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    },
    env: kernelEnv(input, byo),
    resources: {
      requests: { cpu: "500m", memory: "1Gi" },
      limits: { cpu: "1", memory: "2Gi" },
    },
    ...(byo
      ? { volumeMounts: [{ name: WORKSPACE_VOLUME, mountPath: WORKSPACE_PATH }] }
      : {}),
  };

  const podSpec: k8s.V1PodSpec = {
    restartPolicy: "Never",
    imagePullSecrets: [{ name: "ghcr-pull-secret" }],
    securityContext: {
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
    },
    containers: [kernelContainer],
  };

  if (byo) {
    podSpec.volumes = [{ name: WORKSPACE_VOLUME, emptyDir: {} }];
    // Native sidecar (k8s ≥ 1.28): an initContainer with restartPolicy Always
    // starts before and runs alongside the kernel, and is auto-terminated when
    // the kernel container exits — so the Job completes on the kernel's result.
    podSpec.initContainers = [
      {
        name: "toolchain",
        image: toolchainImage,
        restartPolicy: "Always",
        command: ["/bin/sh", "-c", RELAY_SCRIPT],
        env: [
          { name: "LORE_RELAY_DIR", value: RELAY_DIR },
          { name: "LORE_RELAY_WORKDIR", value: RELAY_WORKDIR },
          { name: "HOME", value: TOOLCHAIN_HOME },
        ],
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"] },
        },
        volumeMounts: [{ name: WORKSPACE_VOLUME, mountPath: WORKSPACE_PATH }],
      },
    ];
  }

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName,
      namespace,
      labels: { "lore.re-cinq.com/task-id": spec.taskId },
    },
    spec: {
      activeDeadlineSeconds: (spec.timeoutMinutes || 30) * 60,
      ttlSecondsAfterFinished: 300,
      backoffLimit: 1,
      template: {
        metadata: {
          labels: {
            "lore.re-cinq.com/task-id": spec.taskId,
            "lore.re-cinq.com/component": "job",
          },
        },
        spec: podSpec,
      },
    },
  };
}
