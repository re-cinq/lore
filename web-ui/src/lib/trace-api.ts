// Thin server-side client for the mcp-server spec-traceability /trace API — the
// graph (source of truth) reached through the shared Project facade, NOT direct
// Postgres/Dgraph queries. web-ui is not a workspace member, so the HTTP API is
// the boundary (same LORE_API_URL + LORE_INGEST_TOKEN the context-preview route
// already uses). IO glue — excluded from coverage like lib/db.ts.

import type { TraceDocument } from '@/app/repos/[owner]/[repo]/specs/[...path]/TraceDocumentView';
import type { SpecGraph, SpecRing } from '@/lib/spec-graph';

export type { TraceDocument };

function creds(): { api: string; token: string } | null {
  const api = process.env.LORE_API_URL;
  const token = process.env.LORE_INGEST_TOKEN;
  return api && token ? { api, token } : null;
}

async function apiGet<T>(pathAndQuery: string): Promise<T | null> {
  const c = creds();
  if (!c) return null;
  const res = await fetch(`${c.api}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${c.token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function traceGet<T>(repo: string, kindAndQuery: string): Promise<T | null> {
  return apiGet<T>(`/api/repos/${repo}/trace/${kindAndQuery}`);
}

/** Spec document paths the graph holds for the repo. */
export async function fetchTraceSpecs(repo: string): Promise<string[]> {
  return (await traceGet<{ specs: string[] }>(repo, 'specs'))?.specs ?? [];
}

/** ADR document paths the graph holds for the repo. */
export async function fetchTraceAdrs(repo: string): Promise<string[]> {
  return (await traceGet<{ adrs: string[] }>(repo, 'adrs'))?.adrs ?? [];
}

/** One spec's ordered Section/Statement structure + links + coverage. */
export async function fetchTraceDocument(repo: string, filePath: string): Promise<TraceDocument | null> {
  return traceGet<TraceDocument>(repo, `document?path=${encodeURIComponent(filePath)}`);
}

/** Byte-exact source of any ingested document (specs, ADRs), reassembled from the graph. */
export async function fetchTraceSource(repo: string, filePath: string): Promise<string | null> {
  return (await traceGet<{ source: string | null }>(repo, `source?path=${encodeURIComponent(filePath)}`))?.source ?? null;
}

/** The repo's spec force-graph for the Graph tab. */
export async function fetchTraceGraph(repo: string): Promise<SpecGraph> {
  return (await traceGet<SpecGraph>(repo, 'graph')) ?? { nodes: [], links: [] };
}

/** One spec's two-ring structure (sections + per-statement coverage) for graph expansion. */
export async function fetchTraceRing(repo: string, filePath: string): Promise<SpecRing> {
  return (await traceGet<SpecRing>(repo, `ring?path=${encodeURIComponent(filePath)}`)) ?? { sections: [], statements: [] };
}

/** Cross-repo spec list for the global /specs viewer. */
export async function fetchAllSpecs(): Promise<Array<{ repo: string; filePath: string }>> {
  return (await apiGet<{ specs: Array<{ repo: string; filePath: string }> }>('/api/trace/specs'))?.specs ?? [];
}
