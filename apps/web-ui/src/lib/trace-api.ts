// Thin server-side client for the mcp-server spec-traceability /trace API — the
// graph (source of truth) reached through the shared Project facade, NOT direct
// Postgres/Dgraph queries. web-ui is not a workspace member, so the HTTP API is
// the boundary (same LORE_API_URL + LORE_INGEST_TOKEN the context-preview route
// already uses). IO glue — excluded from coverage like lib/db.ts.

import type { TraceDocument } from "@/lib/trace-types";
import type { SpecGraph, SpecRing } from "@/lib/spec-graph";
import type { SpecStatusInfo } from "@/lib/spec-status";

export type { TraceDocument };

/**
 * A global-viewer list entry. The status pill ships with the list rather than
 * being fetched per document: the old one-source-fetch-per-doc fan-out put a
 * single /specs render at 114 requests, over the API's shared 200/min bucket.
 */
export interface GlobalDocEntry {
  repo: string;
  filePath: string;
  status: SpecStatusInfo | null;
}

function creds(): { api: string; token: string } | null {
  const api = process.env.LORE_API_URL;
  const token = process.env.LORE_INGEST_TOKEN;

  return api && token ? { api, token } : null;
}

async function apiGet<T>(pathAndQuery: string): Promise<T | null> {
  const c = creds();

  if (!c) {
    return null;
  }
  const res = await fetch(`${c.api}${pathAndQuery}`, { signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${c.token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as T;
}

function traceGet<T>(repo: string, kindAndQuery: string): Promise<T | null> {
  return apiGet<T>(`/api/repos/${repo}/trace/${kindAndQuery}`);
}

/** Spec document paths the graph holds for the repo. */
export async function fetchTraceSpecs(repo: string): Promise<string[]> {
  return (await traceGet<{ specs: string[] }>(repo, "specs"))?.specs ?? [];
}

export interface SpecSummary {
  filePath: string;
  title: string;
  description: string;
  coverage: {
    testable: number;
    covered: number;
    untestable: number;
    ratio: number;
  };
  status: SpecStatusInfo | null;
}

/** Card summaries (title/description/coverage) for the repo's specs. */
export async function fetchSpecSummaries(repo: string): Promise<SpecSummary[]> {
  return (
    (await traceGet<{ summaries: SpecSummary[] }>(repo, "spec-summaries"))
      ?.summaries ?? []
  );
}

/** ADR document paths the graph holds for the repo. */
export async function fetchTraceAdrs(repo: string): Promise<string[]> {
  return (await traceGet<{ adrs: string[] }>(repo, "adrs"))?.adrs ?? [];
}

export interface AdrSummary {
  filePath: string;
  title: string;
  description: string;
  status: SpecStatusInfo | null;
}

/** Card summaries (title/description) for the repo's ADRs. */
export async function fetchAdrSummaries(repo: string): Promise<AdrSummary[]> {
  return (
    (await traceGet<{ summaries: AdrSummary[] }>(repo, "adr-summaries"))
      ?.summaries ?? []
  );
}

/** One spec's ordered Section/Statement structure + links + coverage. */
export async function fetchTraceDocument(
  repo: string,
  filePath: string,
): Promise<TraceDocument | null> {
  return traceGet<TraceDocument>(
    repo,
    `document?path=${encodeURIComponent(filePath)}`,
  );
}

/** Byte-exact source of any ingested document (specs, ADRs), reassembled from the graph. */
export async function fetchTraceSource(
  repo: string,
  filePath: string,
): Promise<string | null> {
  return (
    (
      await traceGet<{ source: string | null }>(
        repo,
        `source?path=${encodeURIComponent(filePath)}`,
      )
    )?.source ?? null
  );
}

/** The repo's spec force-graph for the Graph tab. */
export async function fetchTraceGraph(repo: string): Promise<SpecGraph> {
  return (await traceGet<SpecGraph>(repo, "graph")) ?? { nodes: [], links: [] };
}

/** One spec's two-ring structure (sections + per-statement coverage) for graph expansion. */
export async function fetchTraceRing(
  repo: string,
  filePath: string,
): Promise<SpecRing> {
  return (
    (await traceGet<SpecRing>(
      repo,
      `ring?path=${encodeURIComponent(filePath)}`,
    )) ?? { sections: [], statements: [] }
  );
}

/** Cross-repo spec list for the global /specs viewer. */
export async function fetchAllSpecs(): Promise<GlobalDocEntry[]> {
  return (
    (await apiGet<{ specs: GlobalDocEntry[] }>("/api/trace/specs"))?.specs ?? []
  );
}

/** Cross-repo ADR list for the global /adrs viewer. */
export async function fetchAllAdrs(): Promise<GlobalDocEntry[]> {
  return (
    (await apiGet<{ adrs: GlobalDocEntry[] }>("/api/trace/adrs"))?.adrs ?? []
  );
}
