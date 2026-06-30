// Catalog editor → CRDs (ADR-031 D2, #698): the /agents editor's saves resolve to a
// recipe (libs/shared AgentDefinition) which we materialise as the source-of-truth
// AgentDefinition + Station custom resources the Floor dispatches against. Mirrors the
// seed mapping (apps/floor agent-catalog.ts) but from the resolved recipe shape; pure +
// deterministic. The k8s apply/delete is the IO shell (agent-crd-k8s.ts).

import type { AgentDefinition as RecipeDef } from "@re-cinq/lore-shared";
import type { AgentDefinition, Station, OutputSink } from "@re-cinq/agent-contracts";

const API_VERSION = "agents.re-cinq.com/v1alpha1";
const BASE_IMAGE = "node:22-bookworm";
const UI_LABELS = { "app.kubernetes.io/managed-by": "lore-catalog-ui" };

export interface CrdPair {
  agentDefinition: AgentDefinition;
  station: Station;
}

export interface CrdOptions {
  /** Telemetry sink URL (D8); when set, an http sink is added alongside stdout so a
   *  UI edit doesn't drop cost accounting. */
  eventsUrl?: string;
}

export function agentDefToCrds(def: RecipeDef, opts: CrdOptions = {}): CrdPair {
  const sinks: OutputSink[] = [{ type: "stdout" }];
  if (opts.eventsUrl) {
    sinks.push({ type: "http", url: opts.eventsUrl, headers_secret: "agent-events-auth" });
  }
  return {
    agentDefinition: {
      apiVersion: API_VERSION,
      kind: "AgentDefinition",
      metadata: { name: def.name, labels: { ...UI_LABELS } },
      spec: {
        description: `Lore ${def.name} recipe (UI-authored).`,
        ...(def.model ? { model: def.model } : {}),
        // {context} is filled by the Floor's context hydration (D5).
        ...(def.prompt ? { prompt: `${def.prompt}\n\n{context}` } : {}),
        permission_mode: "bypass",
        max_turns: 40,
        output: { sinks },
      },
    },
    station: {
      apiVersion: API_VERSION,
      kind: "Station",
      metadata: { name: def.name, labels: { ...UI_LABELS } },
      spec: {
        agentDefRef: def.name,
        deadlineMinutes: def.timeout_minutes ?? 30,
        template: {
          spec: {
            containers: [
              {
                name: "agent",
                image: def.image ?? BASE_IMAGE,
                resources: {
                  requests: { cpu: "250m", memory: "512Mi" },
                  limits: { cpu: "1", memory: "1Gi" },
                },
              },
            ],
          },
        },
      },
    },
  };
}
