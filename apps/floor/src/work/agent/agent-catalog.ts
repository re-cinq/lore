// Renders the built catalog (catalog-builders.ts) as the ai-agents-helm chart file: one YAML doc per CR, with the __*__ sentinels turned back into Helm value references and the cluster-optional blocks wrapped in `{{- if }}` guards.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { stringify } from "yaml";
import {
  buildCatalog,
  API_URL_SENTINEL,
  EVENTS_URL_SENTINEL,
  GKE_DGRAPH_URL,
  LLM_SECRET_SENTINEL,
  MCP_URL_SENTINEL,
  NAMESPACE_SENTINEL,
  SKILLS_SOURCE_SENTINEL,
  STATION_IMAGE_SENTINEL,
  type AgentCatalogConfig,
  type StationCatalogConfig,
} from "./catalog-builders.js";

export {
  buildAgentDefinition,
  buildCatalog,
  buildStation,
  buildStationDefinition,
  buildStationStation,
  stationName,
  LLM_SECRET_SENTINEL,
  type AgentCatalogConfig,
  type StationCatalogConfig,
} from "./catalog-builders.js";

/** Wraps the parts of a recipe a cluster may not be able to satisfy in `{{- if }}` guards. Each one exists because the UNGUARDED form fails hard rather than degrading: an empty-url MCP entry, a skills list with no source (the init reports SUCCESS and the container then dies on the missing settings.json), a telemetry sink a satellite has no credential for, and a `{context}` slot that only means anything where an MCP exists. */
function guardMcpAndContext(body: string): string {
  return body
    .replace(
      /^( *)mcp_servers:\n((?:\1 .*\n)*)/gm,
      (_m, indent: string, entries: string) =>
        `{{- if .Values.loreMcpUrl }}\n${indent}mcp_servers:\n${entries}{{- end }}\n`,
    )
    .replace(
      /^( *)\{context\}\n/gm,
      (_m, indent: string) =>
        `{{- if .Values.loreMcpUrl }}\n${indent}{context}\n{{- end }}\n`,
    );
}

function guardSkillsAndSinks(body: string): string {
  return body
    .replace(
      /^( *)skills:\n((?:\1 .*\n)*)\1skills_source: (.*)\n/gm,
      (_m, indent: string, entries: string, source: string) =>
        `{{- if .Values.loreSkillsUrl }}\n${indent}skills:\n${entries}${indent}skills_source: ${source}\n{{- end }}\n`,
    )
    .replace(
      /^( *)- type: http\n\1 {2}url: .*\n\1 {2}headers_secret: agent-events-auth\n/gm,
      (match) => `{{- if .Values.agentEventsUrl }}\n${match}{{- end }}\n`,
    );
}

function applyHelmGuards(body: string): string {
  return guardMcpAndContext(guardSkillsAndSinks(body));
}

/** One CR as YAML. `resource-policy: keep` because a helm uninstall must not take the recipes with it, and block scalars are LITERAL (`|`) rather than folded (`>-`) — folding would rewrap a prompt's indented JSON and code blocks, silently changing the recipe the pod runs. */
function renderCr(cr: AgentDefinition | Station): string {
  return stringify(
    {
      ...cr,
      metadata: {
        ...cr.metadata,
        namespace: NAMESPACE_SENTINEL,
        annotations: { "helm.sh/resource-policy": "keep" },
      },
    },
    { blockQuote: "literal" },
  );
}

/** Turns the sentinels back into Helm value references. They exist because the catalog is BUILT as valid YAML first — templating `{{ ... }}` straight into it would not parse, and a mis-quoted template only fails at deploy time. */
function substituteHelmValues(body: string): string {
  return applyHelmGuards(body)
    .replaceAll(LLM_SECRET_SENTINEL, "{{ .Values.agentLlmSecretKey }}")
    .replaceAll(EVENTS_URL_SENTINEL, "{{ .Values.agentEventsUrl }}")
    .replaceAll(MCP_URL_SENTINEL, "{{ .Values.loreMcpUrl }}")
    .replaceAll(SKILLS_SOURCE_SENTINEL, "{{ .Values.loreSkillsUrl }}")
    .replaceAll(API_URL_SENTINEL, "{{ .Values.loreApiUrl }}")
    .replaceAll(GKE_DGRAPH_URL, "{{ .Values.dgraphUrl }}")
    .replaceAll(NAMESPACE_SENTINEL, "{{ .Values.namespace }}")
    .replaceAll(STATION_IMAGE_SENTINEL, "{{ .Values.stationImage }}");
}

/** The ai-agents-helm `files/catalog-seed.yaml` body, applied SERVER-SIDE by the `catalog-seed` pre-upgrade hook rather than as a template — Helm diffs rendered manifests and never reads live state, so a pruned object (#1301) stays pruned through later no-op deploys (#1468). */
export function catalogChartYaml(
  taskTypes: Record<string, AgentCatalogConfig>,
  stationTypes: Record<string, StationCatalogConfig> = {},
): string {
  const header =
    "# Code generated from scripts/task-types.yaml by gen-catalog. DO NOT EDIT.\n" +
    "# Seeded catalog (ADR-031, re-cinq/lore#698). Lives at files/catalog-seed.yaml and is\n" +
    "# applied server-side by the catalog-seed pre-upgrade hook (templates/catalog-seed-job.yaml),\n" +
    "# which runs AFTER the CRD hook so a lagging schema cannot prune these fields (#1468).\n" +
    "# .Values.seedCatalog gates the hook, not this file.\n";
  const docs = buildCatalog(taskTypes, stationTypes).map(renderCr);

  return substituteHelmValues(`${header}---\n${docs.join("---\n")}`);
}
