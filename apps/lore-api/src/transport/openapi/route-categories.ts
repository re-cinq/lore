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
  {
    name: "Plans",
    description: "Plans written together with the planning agent (ADR-047).",
  },
  { name: "Agents", description: "Per-repo agent definitions." },
  { name: "Ingestion", description: "Content and graph ingestion." },
  {
    name: "Traceability",
    description: "Spec-traceability queries and change impact.",
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
  { name: "Meta", description: "The OpenAPI document and its reference UI." },
];

const UNCATEGORIZED = "Other";

/** Path→category rules, first match wins; ordered specific → general. */
const TAG_RULES: Array<[RegExp, string]> = [
  [/^\/api\/(openapi\.json|docs)$/, "Meta"],
  [/^\/api\/(context|search-context|graph|chunks|chunk-types)\b/, "Context"],
  [
    /^\/api\/(memory|memories|memory-search|memory-audit|episode|episodes|pools|graph-browse|session-summary)\b/,
    "Memory",
  ],
  [
    /^\/api\/(task|tasks|task-logs|task-stats|repo-tasks|agent-activity|audit-log|job-run-logs|spec-tasks|task-groups|assembly-lines|assembly-runs|floor-runs)\b/,
    "Tasks",
  ],
  [
    /^\/api\/(usage|analytics|analytics-overview|spend|agent-stats|memory-audit|events|job-runs)\b/,
    "Analytics",
  ],
  // Platform health (model access status) tagged analytics: same audience, same question.
  [/^\/api\/platform\//, "Analytics"],
  [/\/plans\b/, "Plans"],
  [/\/agent-definitions\b/, "Agents"],
  // The floor asks for a git credential on a pod's behalf: the GitHub App's, so it sits with the repositories.
  [/^\/api\/floor\/git-credential$/, "Repositories"],
  // A review started by hand is a run started, the same as any other.
  [/^\/api\/review\/start$/, "Tasks"],
  [/\/(trace|impact)\b/, "Traceability"],
  // The test links a spec carries are the traceability graph's validated-by edges, read before they are ingested.
  [/^\/api\/spec-links\b/, "Traceability"],
  [/\/ingest/, "Ingestion"],
  [/^\/api\/embeddings$/, "Ingestion"],
  [/\/events\/\{id\}\/payload$/, "Ingestion"],
  [/\/webhook/, "Webhooks"],
  [/^\/api\/tokens\b/, "Tokens"],
  // Connecting GitHub decides which orgs' repos Lore can serve.
  [/^\/api\/github\/installations\b/, "Repositories"],
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
