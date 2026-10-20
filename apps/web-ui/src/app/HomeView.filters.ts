import { type IngestWorkflowStatus } from "@/lib/ingest-workflow";

/** The chips above the repo grid, in the order they are shown. */
export const REPO_FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "running", label: "Agents running" },
] as const;

export type RepoFilter = (typeof REPO_FILTERS)[number]["id"];

/** A fix a repo needs, and how loudly to say so. */
export interface Attention {
  label: string;
  tone: "danger" | "warning";
}

/** Reads `?filter=`; anything unknown is "all", so a stale link still shows every repo. */
export function parseRepoFilter(
  raw: string | string[] | undefined,
): RepoFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return REPO_FILTERS.find((f) => f.id === value)?.id ?? "all";
}

/** The most urgent fix a repo's workflows need, or null when both are current. A missing ingest workflow outranks an outdated one: without it the repo has no context at all. */
export function repoAttention(
  fullName: string,
  ingestStatus: ReadonlyMap<string, IngestWorkflowStatus>,
  impactMisaligned: ReadonlySet<string>,
): Attention | null {
  const ingest = ingestStatus.get(fullName);

  if (ingest === "missing") {
    return { label: "No ingest workflow", tone: "danger" };
  }

  if (ingest === "stale") {
    return { label: "Ingest workflow outdated", tone: "warning" };
  }

  if (impactMisaligned.has(fullName)) {
    return { label: "Spec-impact workflow outdated", tone: "warning" };
  }

  return null;
}

interface FilterableRepo {
  full_name: string;
  active_agents: number;
}

/** The repos a chip keeps. */
export function filterRepos<R extends FilterableRepo>(
  repos: R[],
  filter: RepoFilter,
  attention: ReadonlyMap<string, Attention>,
): R[] {
  if (filter === "attention") {
    return repos.filter((r) => attention.has(r.full_name));
  }

  if (filter === "running") {
    return repos.filter((r) => r.active_agents > 0);
  }

  return repos;
}
