import type * as k8s from "@kubernetes/client-node";
import { GROUP, VERSION, type Agent, type AgentDefinition, type Station } from "./cr-types.js";
import { renderPrompt } from "./render-prompt.js";

/**
 * Pure: wrap a Station's Pod template into a Kubernetes Job and wire the agent
 * container from the recipe + the prompt rendered from the Agent's parameters
 * (ADR-031). The named "agent" container (or the sole container) receives the
 * run's env; the Job carries the Station's time limit and is owned by the Agent
 * (so deleting the Agent cascades to the Job). Mirrors the LoreTask job-builder.
 */

const AGENT_CONTAINER = "agent";
const COMPONENT_LABEL = "lore.re-cinq.com/component";
const AGENT_LABEL = "lore.re-cinq.com/agent";
const STATION_LABEL = "lore.re-cinq.com/station";

export function buildAgentJob(
  agent: Agent,
  station: Station,
  agentDef: AgentDefinition,
  namespace: string,
): k8s.V1Job {
  const runName = agent.metadata.name ?? "agent-run";
  const stationName = station.metadata.name ?? "";
  const prompt = renderPrompt(agentDef.spec.prompt, agent.spec.parameters);

  // Deep-clone the Station's pod template so the in-memory CR is never mutated.
  const template: k8s.V1PodTemplateSpec = structuredClone(station.spec.template ?? {});
  template.spec ??= { containers: [] };
  template.spec.restartPolicy ??= "Never";
  const containers = template.spec.containers ?? [];

  let agentContainer = containers.find((c) => c.name === AGENT_CONTAINER);
  if (!agentContainer && containers.length === 1) agentContainer = containers[0];
  if (!agentContainer) {
    agentContainer = { name: AGENT_CONTAINER };
    containers.push(agentContainer);
  }
  template.spec.containers = containers;

  const extraEnv: k8s.V1EnvVar[] = [{ name: "LORE_PROMPT", value: prompt }];
  if (agentDef.spec.model) extraEnv.push({ name: "LORE_MODEL", value: agentDef.spec.model });
  if (agentDef.spec.permission_mode)
    extraEnv.push({ name: "LORE_PERMISSION_MODE", value: agentDef.spec.permission_mode });
  if (agentDef.spec.max_turns !== undefined)
    extraEnv.push({ name: "LORE_MAX_TURNS", value: String(agentDef.spec.max_turns) });
  if (agent.spec.parameters)
    extraEnv.push({ name: "LORE_PARAMETERS", value: JSON.stringify(agent.spec.parameters) });
  if (agent.spec.targetRepo) extraEnv.push({ name: "TARGET_REPO", value: agent.spec.targetRepo });
  if (agent.spec.branch) extraEnv.push({ name: "BRANCH_NAME", value: agent.spec.branch });
  if (agent.spec.taskId) extraEnv.push({ name: "LORE_TASK_ID", value: agent.spec.taskId });
  agentContainer.env = [...(agentContainer.env ?? []), ...extraEnv];

  template.metadata ??= {};
  template.metadata.labels = {
    ...(template.metadata.labels ?? {}),
    [COMPONENT_LABEL]: "job",
    [AGENT_LABEL]: runName,
    [STATION_LABEL]: stationName,
  };

  const deadlineMinutes = station.spec.deadlineMinutes ?? 30;

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: `agent-job-${runName}`,
      namespace,
      labels: { [AGENT_LABEL]: runName, [STATION_LABEL]: stationName },
      ...(agent.metadata.uid
        ? {
            ownerReferences: [
              {
                apiVersion: `${GROUP}/${VERSION}`,
                kind: "Agent",
                name: runName,
                uid: agent.metadata.uid,
                controller: true,
                blockOwnerDeletion: true,
              },
            ],
          }
        : {}),
    },
    spec: {
      activeDeadlineSeconds: deadlineMinutes * 60,
      ttlSecondsAfterFinished: 300,
      backoffLimit: 1,
      template,
    },
  };
}
