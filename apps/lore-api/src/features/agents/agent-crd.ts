// Catalog editor → CRDs (ADR-031 D2, #698): the /agents editor's saves resolve to a
// recipe (libs/shared AgentDefinition) which we materialise as the source-of-truth
// AgentDefinition + Station custom resources the Floor dispatches against. Mirrors the
// seed mapping (apps/floor agent-catalog.ts) but from the resolved recipe shape; pure +
// deterministic. The k8s apply/delete is the IO shell (agent-crd-k8s.ts).

import Boom from "@hapi/boom";
import type { AgentDefinition as RecipeDef } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  AgentDefinition,
  AgentDefinitionSpec,
  Station,
  OutputSink,
} from "@re-cinq/agent-contracts";

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
  /**
   * The live Lore MCP gateway (ADR-030), from the deploy value — never a host in a
   * DB row, which no rollout could correct.
   *
   * Unset leaves `mcp_servers` off entirely, matching the events sink: a server the
   * pod cannot reach is worse than none, and it keeps the field inert until the
   * gateway is actually deployed.
   */
  mcpUrl?: string;
}

/**
 * The `lore` MCP entry and the pipeline-tool deny, mirroring what
 * `buildAgentDefinition` seeds onto the org-default recipes (apps/floor
 * agent-catalog.ts).
 *
 * A UI-authored recipe used to get NEITHER, so a repo that overrode its recipe
 * through /agents silently lost the mid-run memory and context access every seeded
 * recipe has — and lost the guard that stops an agent spawning more pipeline work
 * from inside a run (#1080). Injected at render time rather than surfaced as an
 * editable field, so a custom recipe gets it without every author remembering to.
 *
 * The deny is UNCONDITIONAL. The gateway already omits the tool in agent mode, so
 * this is defence in depth — and making it conditional on the URL being configured
 * would drop it in exactly the deployments where the config is wrong.
 */
function loreResources(
  mcpUrl: string | undefined,
): Pick<AgentDefinitionSpec, "resources" | "disallowed_tools"> {
  return {
    ...(mcpUrl
      ? {
          resources: {
            mcp_servers: [
              {
                name: "lore",
                transport: "http" as const,
                url: mcpUrl,
                headers_secret: "lore-mcp-auth",
              },
            ],
          },
        }
      : {}),
    disallowed_tools: ["mcp__lore__lore_create_pipeline_task"],
  };
}

/** exec-vendor station (ADR-031 amendment): a non-LLM node run by the pod's
 *  `lore-station <type>` entrypoint. The whole node input rides the {station_input}
 *  prompt; tool_config.command names the entrypoint, derived from the def-<type>
 *  name — a custom image honoring the station contract drops in by pointing
 *  station_ref at its row. */
function stationSpec(
  def: RecipeDef,
  sinks: OutputSink[],
  mcpUrl?: string,
): AgentDefinitionSpec {
  return {
    ...loreResources(mcpUrl),
    description: `Lore ${def.name} station recipe (UI-authored).`,
    model: "exec",
    prompt: "{station_input}",
    permission_mode: "bypass",
    max_turns: 1,
    tool_config: { command: ["lore-station", def.name.replace(/^def-/, "")] },
    output: { sinks },
  };
}

function llmSpec(
  def: RecipeDef,
  sinks: OutputSink[],
  mcpUrl?: string,
): AgentDefinitionSpec {
  // The subsystem rejects a promptless AgentDefinition at admission
  // (ai-agent-subsystem#155). Emitting the spec without one just moved the failure
  // to the apply, where it surfaces as an opaque API-server rejection.
  enforceTrue(def.prompt, Boom.badRequest, `recipe ${def.name} has no prompt`);

  return {
    ...loreResources(mcpUrl),
    description: `Lore ${def.name} recipe (UI-authored).`,
    ...(def.model ? { model: def.model } : {}),
    // {context} is filled by the Floor's context hydration (D5).
    prompt: `${def.prompt}\n\n{context}`,
    permission_mode: "bypass",
    max_turns: 40,
    output: { sinks },
  };
}

export function agentDefToCrds(def: RecipeDef, opts: CrdOptions = {}): CrdPair {
  const sinks: OutputSink[] = [{ type: "stdout" }];

  if (opts.eventsUrl) {
    sinks.push({
      type: "http",
      url: opts.eventsUrl,
      headers_secret: "agent-events-auth",
    });
  }
  const isStation = def.execution_mode === "station";

  return {
    agentDefinition: {
      apiVersion: API_VERSION,
      kind: "AgentDefinition",
      metadata: { name: def.name, labels: { ...UI_LABELS } },
      spec: isStation
        ? stationSpec(def, sinks, opts.mcpUrl)
        : llmSpec(def, sinks, opts.mcpUrl),
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
