// Per-task GitHub token (ADR-031 D6 / #697): pure core (key naming + clone/inject transforms); IO in KubeTokenProvisioner.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import type { LoreTaskSpec } from "../project/agents/k8s-port.js";
import { enforceTrue } from "../lib/enforce.js";

const TASK_ID_LABEL = "lore.re-cinq.com/task-id";

/** The per-task key inside the shared `agent-secrets` Secret. */
export function tokenSecretKey(taskId: string): string {
  return `GH_TOKEN_${taskId.substring(0, 8)}`;
}

/** The per-task AgentDefinition/Station name (one of each per run). */
export function perTaskName(taskId: string): string {
  return `pt-${taskId.substring(0, 8)}`;
}

/** A task that targets a repo needs a git token to clone/push. */
export function needsToken(spec: LoreTaskSpec): boolean {
  return !!spec.targetRepo;
}

/** Catalog recipe the per-task triple clones: spec's explicit Station or task type (#2026-07-17 fix). */
export function catalogLookupName(spec: LoreTaskSpec): string {
  return spec.stationRef ?? spec.taskType;
}

/** Clone catalog AgentDef per-task: rename, label with task id, add repo with token-secret (for subsystem init); recipe preserved. */
export function injectRepoToken(
  catalog: AgentDefinition,
  spec: LoreTaskSpec,
  tokenKey: string,
  name: string,
): AgentDefinition {
  // Subsystem rejects promptless AgentDef at admission (ai-agent-subsystem#155); fail here with task id known.
  enforceTrue(
    catalog.spec?.prompt,
    Error,
    `catalog recipe ${catalog.metadata?.name} has no prompt; task ${spec.taskId}`,
  );

  return {
    ...catalog,
    metadata: {
      name,
      labels: {
        ...(catalog.metadata?.labels ?? {}),
        [TASK_ID_LABEL]: spec.taskId,
      },
    },
    spec: {
      ...catalog.spec,
      resources: {
        ...(catalog.spec?.resources ?? {}),
        // Conversation is per-RUN (id-identified); rides per-task clone like repo token; catalog recipe cannot carry it.
        ...(spec.conversation
          ? {
              conversation: {
                source: spec.conversation.source,
                id: spec.conversation.id,
                pin: spec.conversation.pin,
                headers_secret: spec.conversation.headersSecret,
              },
            }
          : {}),
        repos: [
          {
            name: "target",
            url: `https://github.com/${spec.targetRepo}.git`,
            ...(spec.branch ? { ref: spec.branch } : {}),
            token_secret: tokenKey,
          },
        ],
      },
    },
  };
}

/** Clone a catalog Station into a per-task one referencing the per-task AgentDefinition. */
export function perTaskStation(
  catalog: Station,
  name: string,
  agentDefRef: string,
  taskId: string,
): Station {
  return {
    ...catalog,
    metadata: {
      name,
      labels: { ...(catalog.metadata?.labels ?? {}), [TASK_ID_LABEL]: taskId },
    },
    spec: { ...(catalog.spec ?? { template: {} }), agentDefRef },
  };
}
