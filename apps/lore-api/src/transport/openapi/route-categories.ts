// The OpenAPI sidebar's tag taxonomy: display-ordered categories plus the path→category rules.

/** Sidebar categories in display order; drift guard asserts every operation lands in real category. */
export const CATEGORY_ORDER: Array<{ name: string; description: string }> = [
  { name: "Context", description: "Context assembly and the knowledge graph." },
  {
    name: "Memory",
    description: "Agent memory: entries, episodes, and session summaries.",
  },
  {
    name: "Tasks",
    description: "Pipeline task lifecycle, timelines, and logs.",
  },
  {
    name: "Repositories",
    description: "Onboarded repositories and their status.",
  },
  { name: "Features", description: "Feature-planning iterations." },
  { name: "Agents", description: "Per-repo agent definitions." },
  {
    name: "Cluster Agents",
    description: "Execution-cluster registry and pull-based dispatch.",
  },
  { name: "Ingestion", description: "Content and graph ingestion." },
  {
    name: "Traceability",
    description: "Spec-traceability queries and change impact.",
  },
  {
    name: "Dark Factory",
    description: "Autonomous-mode (dark factory) settings.",
  },
  {
    name: "Webhooks",
    description: "Inbound webhooks and per-repo webhook configuration.",
  },
  {
    name: "Analytics",
    description: "Usage, org-wide pipeline analytics, and agent statistics.",
  },
  { name: "Tokens", description: "Scoped API token management." },
  {
    name: "Cluster Agents",
    description:
      "Execution-cluster registry and pull-based station-run dispatch (specs/running-stations-in-any-k8s-cluster).",
  },
  { name: "Meta", description: "The OpenAPI document and its reference UI." },
];

const UNCATEGORIZED = "Other";

/** Path→category rules, first match wins; ordered specific → general. */
const TAG_RULES: Array<[RegExp, string]> = [
  [/^\/api\/(openapi\.json|docs)$/, "Meta"],
  [/^\/api\/(context|graph|chunks|chunk-types)\b/, "Context"],
  [
    /^\/api\/(memory|memories|memory-search|memory-audit|episode|episodes|pools|graph-browse|session-summary)\b/,
    "Memory",
  ],
  [
    /^\/api\/(task|tasks|task-logs|task-stats|repo-tasks|agent-activity|audit-log|job-run-logs|spec-tasks|task-groups|assembly-lines|assembly-runs)\b/,
    "Tasks",
  ],
  [
    /^\/api\/(usage|analytics|analytics-overview|spend|agent-stats|memory-audit|events|job-runs)\b/,
    "Analytics",
  ],
  // Platform health (model access status) tagged analytics: same audience, same question.
  [/^\/api\/platform\//, "Analytics"],
  [/\/features\b/, "Features"],
  [/\/agent-definitions\b/, "Agents"],
  [/^\/api\/cluster-agents\b/, "Cluster Agents"],
  [/\/settings\/dark-factory\b/, "Dark Factory"],
  [/\/(trace|impact)\b/, "Traceability"],
  [/\/ingest/, "Ingestion"],
  [/^\/api\/embed$/, "Ingestion"],
  [/\/events\/\{id\}\/payload$/, "Ingestion"],
  [/\/webhook/, "Webhooks"],
  [/^\/api\/tokens\b/, "Tokens"],
  [/^\/api\/cluster-agents\b/, "Cluster Agents"],
  [/^\/api\/(repos|repo-status|pr-status|onboard|settings)\b/, "Repositories"],
];

/** The sidebar category for a normalized path. */
export function tagFor(normPath: string): string {
  for (const [re, tag] of TAG_RULES) {
    if (re.test(normPath)) {
      return tag;
    }
  }

  return UNCATEGORIZED;
}
