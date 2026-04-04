/**
 * LoreTask Kubernetes controller.
 *
 * Watches LoreTask custom resources and creates K8s Jobs to run
 * Claude Code in ephemeral pods. Each Job gets a fresh GitHub App
 * installation token via a per-task K8s Secret.
 *
 * Designed to run in-cluster as part of the Lore Agent deployment.
 */

import * as k8s from "@kubernetes/client-node";
import { GitHubPlatform } from "./github.js";
import { writeLogs } from "./lib/log-storage.js";

// ── Constants ───────────────────────────────────────────────────────

const GROUP = "lore.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "loretasks";
const NAMESPACE = process.env.LORETASK_NAMESPACE || "lore-agent";
const POLL_INTERVAL_MS = 15_000;

// ── Types ───────────────────────────────────────────────────────────

interface LoreTaskSpec {
  taskId: string;
  targetRepo: string;
  branch: string;
  prompt: string;
  model?: string;
  taskType?: string;
  prNumber?: number;
  image?: string;
  timeoutMinutes?: number;
}

interface LoreTaskStatus {
  phase?: string;
  jobName?: string;
  startedAt?: string;
  completedAt?: string;
  output?: string;
  changedFiles?: number;
  reviewResult?: string;
  parentTaskId?: string;
  failureReason?: string;
  exitCode?: number;
  logUrl?: string;
}

interface LoreTask {
  apiVersion: string;
  kind: string;
  metadata: k8s.V1ObjectMeta;
  spec: LoreTaskSpec;
  status?: LoreTaskStatus;
}

// ── K8s clients ─────────────────────────────────────────────────────

let customApi: k8s.CustomObjectsApi;
let batchApi: k8s.BatchV1Api;
let coreApi: k8s.CoreV1Api;

function initClients(): void {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();

  customApi = kc.makeApiClient(k8s.CustomObjectsApi);
  batchApi = kc.makeApiClient(k8s.BatchV1Api);
  coreApi = kc.makeApiClient(k8s.CoreV1Api);

  console.log("[controller] K8s clients initialized (in-cluster)");
}

// ── GitHub token helper ─────────────────────────────────────────────

/**
 * Create a short-lived K8s Secret containing a fresh GitHub App
 * installation token for the given task. Returns the secret name.
 */
async function createTokenSecret(taskIdShort: string): Promise<string> {
  const gh = new GitHubPlatform();
  const token = await gh.getInstallationToken();
  const secretName = `loretask-github-token-${taskIdShort}`;

  const secret: k8s.V1Secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secretName,
      namespace: NAMESPACE,
      labels: { "lore.re-cinq.com/managed-by": "loretask-controller" },
    },
    type: "Opaque",
    stringData: {
      "github-token": token,
    },
  };

  try {
    await coreApi.createNamespacedSecret({ namespace: NAMESPACE, body: secret });
  } catch (err: any) {
    if (err?.response?.statusCode === 409) {
      // Secret exists from previous attempt — delete and recreate with fresh token
      try { await coreApi.deleteNamespacedSecret({ name: secretName, namespace: NAMESPACE }); } catch { /* gone */ }
      await coreApi.createNamespacedSecret({ namespace: NAMESPACE, body: secret });
    } else {
      throw err;
    }
  }

  return secretName;
}

/**
 * Delete the per-task GitHub token secret. Best effort.
 */
async function deleteTokenSecret(taskIdShort: string): Promise<void> {
  const secretName = `loretask-github-token-${taskIdShort}`;
  try {
    await coreApi.deleteNamespacedSecret({ name: secretName, namespace: NAMESPACE });
  } catch {
    // Already gone or never created — that's fine
  }
}

// ── Status patching ─────────────────────────────────────────────────

async function patchStatus(
  name: string,
  status: Partial<LoreTaskStatus>,
): Promise<void> {
  // Read current, merge status, replace
  const current = await customApi.getNamespacedCustomObjectStatus({
    group: GROUP, version: VERSION, namespace: NAMESPACE, plural: PLURAL, name,
  }) as any;
  const merged = { ...current, status: { ...(current.status || {}), ...status } };
  await customApi.replaceNamespacedCustomObjectStatus({
    group: GROUP, version: VERSION, namespace: NAMESPACE, plural: PLURAL, name,
    body: merged,
  });
}

// ── Reconcile: create a Job for a Pending LoreTask ──────────────────

async function reconcile(lt: LoreTask): Promise<void> {
  const taskId = lt.spec.taskId;
  const taskIdShort = taskId.substring(0, 8);
  const ltName = lt.metadata.name!;

  console.log(`[controller] Reconciling task ${taskId} (${ltName})`);

  // Create a fresh GitHub token secret for this task
  let tokenSecretName: string;
  try {
    tokenSecretName = await createTokenSecret(taskIdShort);
  } catch (err: any) {
    console.error(`[controller] Failed to create token secret for ${taskId}: ${err.message}`);
    await patchStatus(ltName, {
      phase: "Failed",
      failureReason: `Token secret creation failed: ${err.message}`,
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const jobName = `loretask-job-${taskIdShort}`;

  const job: k8s.V1Job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName,
      namespace: NAMESPACE,
      labels: { "lore.re-cinq.com/task-id": taskId },
    },
    spec: {
      activeDeadlineSeconds: (lt.spec.timeoutMinutes || 30) * 60,
      ttlSecondsAfterFinished: 300,
      backoffLimit: 0,
      template: {
        spec: {
          restartPolicy: "Never",
          imagePullSecrets: [{ name: "ghcr-pull-secret" }],
          containers: [
            {
              name: "claude-runner",
              image: lt.spec.image || "ghcr.io/re-cinq/lore-claude-runner:latest",
              env: [
                { name: "TARGET_REPO", value: lt.spec.targetRepo },
                { name: "BRANCH_NAME", value: lt.spec.branch },
                { name: "TASK_PROMPT", value: lt.spec.prompt },
                { name: "MODEL", value: lt.spec.model || "claude-sonnet-4-6" },
                { name: "TASK_TYPE", value: lt.spec.taskType || "implementation" },
                { name: "PR_NUMBER", value: String(lt.spec.prNumber || "") },
                {
                  name: "ANTHROPIC_API_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: "lore-agent-anthropic-key",
                      key: "anthropic-api-key",
                    },
                  },
                },
                {
                  name: "GITHUB_TOKEN",
                  valueFrom: {
                    secretKeyRef: {
                      name: tokenSecretName,
                      key: "github-token",
                    },
                  },
                },
              ],
              resources: {
                requests: { cpu: "500m", memory: "1Gi" },
                limits: { cpu: "1", memory: "2Gi" },
              },
            },
          ],
        },
      },
    },
  };

  try {
    await batchApi.createNamespacedJob({ namespace: NAMESPACE, body: job });
  } catch (err: any) {
    // Job might already exist if we're re-reconciling
    if (err?.response?.statusCode === 409) {
      console.log(`[controller] Job ${jobName} already exists, skipping creation`);
    } else {
      console.error(`[controller] Failed to create job for ${taskId}: ${err.message}`);
      await patchStatus(ltName, {
        phase: "Failed",
        failureReason: `Job creation failed: ${err.message}`,
        completedAt: new Date().toISOString(),
      });
      await deleteTokenSecret(taskIdShort);
      return;
    }
  }

  await patchStatus(ltName, {
    phase: "Running",
    jobName,
    startedAt: new Date().toISOString(),
  });

  console.log(`[controller] Created job ${jobName} for task ${taskId}`);
}

// ── Check Job: monitor completion ───────────────────────────────────

async function checkJob(lt: LoreTask): Promise<void> {
  const ltName = lt.metadata.name!;
  const jobName = lt.status?.jobName;

  if (!jobName) {
    console.warn(`[controller] LoreTask ${ltName} is Running but has no jobName`);
    return;
  }

  let job: k8s.V1Job;
  try {
    const response = await batchApi.readNamespacedJob({ name: jobName, namespace: NAMESPACE });
    job = response;
  } catch (err: any) {
    console.error(`[controller] Failed to read job ${jobName}: ${err.message}`);
    return;
  }

  const conditions = job.status?.conditions || [];
  const complete = conditions.find(
    (c) => c.type === "Complete" && c.status === "True",
  );
  const failed = conditions.find(
    (c) => c.type === "Failed" && c.status === "True",
  );

  const taskIdShort = lt.spec.taskId.substring(0, 8);

  if (complete) {
    const logs = await readPodLogs(jobName);
    const changedFiles = parseChangedFiles(logs);
    const logUrl = `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${lt.spec.targetRepo}/${lt.spec.taskId}/output.log`;

    const status: Partial<LoreTaskStatus> = {
      phase: "Succeeded",
      completedAt: new Date().toISOString(),
      output: logs.slice(-5000),
      changedFiles,
      logUrl,
    };

    if (lt.spec.taskType === "review") {
      const resultMatch = logs.match(/REVIEW_RESULT:(APPROVED|CHANGES_REQUESTED(?::[\s\S]*)?)/);
      if (resultMatch) {
        const isApproved = resultMatch[1].startsWith("APPROVED");
        status.reviewResult = isApproved ? "approved" : "changes-requested";
      }
    }

    await patchStatus(ltName, status);

    try {
      await writeLogs(lt.spec.targetRepo, lt.spec.taskId, logs);
    } catch (err: any) {
      console.warn(`[controller] Failed to write final logs to GCS for ${lt.spec.taskId}: ${err.message}`);
    }

    await deleteTokenSecret(taskIdShort);
    console.log(`[controller] Task ${lt.spec.taskId} succeeded (${changedFiles} files changed)`);
  } else if (failed) {
    const logs = await readPodLogs(jobName);
    const failureReason = parseFailureReason(logs, conditions);
    const exitCode = job.status?.failed ?? undefined;
    const logUrl = `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${lt.spec.targetRepo}/${lt.spec.taskId}/output.log`;

    await patchStatus(ltName, {
      phase: "Failed",
      completedAt: new Date().toISOString(),
      failureReason,
      exitCode: exitCode ? Number(exitCode) : undefined,
      logUrl,
    });

    try {
      await writeLogs(lt.spec.targetRepo, lt.spec.taskId, logs);
    } catch (err: any) {
      console.warn(`[controller] Failed to write failure logs to GCS for ${lt.spec.taskId}: ${err.message}`);
    }

    await deleteTokenSecret(taskIdShort);
    console.error(`[controller] Task ${lt.spec.taskId} failed: ${failureReason}`);
  }
  // Job is still running — stream logs to GCS
  const liveLogs = await readPodLogs(jobName);
  if (liveLogs) {
    await patchStatus(ltName, { output: liveLogs.slice(-5000) });
    try {
      await writeLogs(lt.spec.targetRepo, lt.spec.taskId, liveLogs);
    } catch (err: any) {
      console.warn(`[controller] Failed to write logs to GCS for ${lt.spec.taskId}: ${err.message}`);
    }
  }
}

// ── Pod log helpers ─────────────────────────────────────────────────

/**
 * Find the pod created by a Job and read its logs.
 */
async function readPodLogs(jobName: string): Promise<string> {
  try {
    const pods = await coreApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `job-name=${jobName}`,
    });

    const pod = pods.items[0];
    if (!pod?.metadata?.name) {
      return "(no pod found)";
    }

    const logResponse = await coreApi.readNamespacedPodLog({
      name: pod.metadata.name,
      namespace: NAMESPACE,
      container: "claude-runner",
      tailLines: 500,
    });

    return typeof logResponse === "string" ? logResponse : String(logResponse);
  } catch (err: any) {
    return `(failed to read logs: ${err.message})`;
  }
}

/**
 * Parse the "CHANGES=" line from pod logs to get changed file count.
 */
function parseChangedFiles(logs: string): number {
  const match = logs.match(/CHANGES=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Extract a failure reason from logs and/or Job conditions.
 */
function parseFailureReason(
  logs: string,
  conditions: k8s.V1JobCondition[],
): string {
  // Try to get the reason from the Failed condition
  const failedCondition = conditions.find(
    (c) => c.type === "Failed" && c.status === "True",
  );
  const conditionReason = failedCondition?.reason || "";
  const conditionMessage = failedCondition?.message || "";

  // Try to find an error in the last lines of the logs
  const logLines = logs.trim().split("\n");
  const lastLines = logLines.slice(-10).join("\n");
  const errorMatch = lastLines.match(/(?:Error|FATAL|FAILED):\s*(.+)/i);
  const logError = errorMatch?.[1] || "";

  if (logError) return logError;
  if (conditionMessage) return `${conditionReason}: ${conditionMessage}`;
  if (conditionReason) return conditionReason;
  return "Unknown failure (check pod logs)";
}

// ── List + reconcile loop ───────────────────────────────────────────

async function pollAndReconcile(): Promise<void> {
  try {
    const response = (await customApi.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: NAMESPACE,
      plural: PLURAL,
    })) as { items: LoreTask[] };

    const items: LoreTask[] = response.items || [];

    for (const lt of items) {
      try {
        const phase = lt.status?.phase;

        if (!phase || phase === "Pending") {
          await reconcile(lt);
        } else if (phase === "Running") {
          await checkJob(lt);
        }
        // Succeeded / Failed — nothing to do
      } catch (err: any) {
        console.error(
          `[controller] Error processing LoreTask ${lt.metadata.name}: ${err.message}`,
        );
      }
    }
  } catch (err: any) {
    console.error(`[controller] Failed to list LoreTasks: ${err.message}`);
  }
}

// ── Watch handler ───────────────────────────────────────────────────

function handleWatchEvent(type: string, lt: LoreTask): void {
  if (type !== "ADDED" && type !== "MODIFIED") return;

  const phase = lt.status?.phase;
  const ltName = lt.metadata.name || "unknown";

  if (!phase || phase === "Pending") {
    reconcile(lt).catch((err) => {
      console.error(`[controller] Watch reconcile failed for ${ltName}: ${err.message}`);
    });
  } else if (phase === "Running") {
    checkJob(lt).catch((err) => {
      console.error(`[controller] Watch checkJob failed for ${ltName}: ${err.message}`);
    });
  }
}

// ── Start the controller ────────────────────────────────────────────

/**
 * Start the LoreTask controller. Sets up:
 *  - K8s API clients (in-cluster config)
 *  - A watch on LoreTask custom resources
 *  - A fallback poll every 15 seconds
 *
 * Errors on individual tasks are caught and logged; the controller
 * keeps running.
 */
export async function startController(): Promise<void> {
  initClients();
  console.log(`[controller] Watching LoreTasks in namespace ${NAMESPACE}`);

  // Start the watch
  startWatch();

  // Fallback poll loop — catches anything the watch misses
  setInterval(pollAndReconcile, POLL_INTERVAL_MS);

  // Immediate first poll
  await pollAndReconcile();
}

function startWatch(): void {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();

  const watch = new k8s.Watch(kc);
  const watchPath = `/apis/${GROUP}/${VERSION}/namespaces/${NAMESPACE}/${PLURAL}`;

  function doWatch(): void {
    watch
      .watch(
        watchPath,
        {},
        (type: string, apiObj: LoreTask) => {
          handleWatchEvent(type, apiObj);
        },
        (err: any) => {
          if (err) {
            console.error(`[controller] Watch error: ${err.message}`);
          }
          // Reconnect after a brief delay
          setTimeout(doWatch, 5_000);
        },
      )
      .then((req) => {
        // The watch request object — could be used for abort,
        // but we let the error callback handle reconnection.
        console.log("[controller] Watch established");
      })
      .catch((err) => {
        console.error(`[controller] Watch setup failed: ${err.message}`);
        setTimeout(doWatch, 5_000);
      });
  }

  doWatch();
}
