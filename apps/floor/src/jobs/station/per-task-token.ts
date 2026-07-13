// Per-task GitHub token (ADR-031 D6 / #697): a code task that targets a repo needs a
// short-lived git token to clone/push. The Floor mints one, PATCHes it into the single
// `agent-secrets` Secret under a per-task key, and materialises a per-task triple — an
// AgentDefinition (cloned from the catalog recipe, with the target repo + token_secret
// added so the init container clones it with auth) and a Station referencing it — that
// the Agent runs on. The key + triple are removed on terminal. This module is the pure
// core (key naming + the clone/inject transforms); the mint/PATCH/apply IO is in the
// KubeTokenProvisioner.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";

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

/** Clone a catalog AgentDefinition into a per-task one: rename, label with the task id,
 *  and add the target repo carrying the per-task token-secret key (so the subsystem's
 *  init container clones it with auth). The recipe (model/prompt/tools) is preserved. */
export function injectRepoToken(
  catalog: AgentDefinition,
  spec: LoreTaskSpec,
  tokenKey: string,
  name: string,
): AgentDefinition {
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
