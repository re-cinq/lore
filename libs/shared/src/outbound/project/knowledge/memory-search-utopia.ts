// Utopia's arm of memory search (specs/utopia-graph-mirror FR16.11): the hits of a base's `memories` and `episodes` sources, read back as the memory hits Lore's search answers.

import type { SearchHit } from "../../../domain/utopia/read-shapes.js";
import type { MemorySearchResult } from "./memory-search.js";

/** The ids of one base's memory sources; null for a kind nothing was pushed to yet. */
export interface MemorySourceIds {
  memories: string | null;
  episodes: string | null;
}

export interface MemoryHitFilter {
  agentId?: string;
  limit: number;
}

export type MemoryExternalId =
  | { kind: "memory"; agentId: string; key: string }
  | { kind: "episode"; id: string };

const MEMORY_ID = /^memory:([^/]+)\/(.+)$/;
const EPISODE_ID = /^episode:(.+)$/;

/** What a pushed id names: `memory:<agent>/<key>` (an agent id holds no slash) or `episode:<id>`; null for any other source's id. */
export function memoryExternalId(externalId: string): MemoryExternalId | null {
  const memory = MEMORY_ID.exec(externalId);

  if (memory) {
    return { kind: "memory", agentId: memory[1], key: memory[2] };
  }
  const episode = EPISODE_ID.exec(externalId);

  return episode ? { kind: "episode", id: episode[1] } : null;
}

interface DocumentHits {
  hit: MemorySearchResult;
  chunks: { seq: number; text: string }[];
}

/** The memories and episodes the hits name, one hit per document in the rank of its best chunk and scored by it, every chunk of a document joined in the order it stands in it. A memory's value is its content without the key line it was pushed under. Scores stay Utopia's own so hits of several bases can be ranked together before `normalizeHitScores`. */
export function utopiaMemoryHits(
  hits: SearchHit[],
  sources: MemorySourceIds,
  filter: MemoryHitFilter,
): MemorySearchResult[] {
  const byId = new Map<string, DocumentHits>();

  for (const hit of hits) {
    addHit(byId, hit, sources, filter);
  }
  const documents = [...byId.values()].slice(0, filter.limit).map(withValue);

  return documents;
}

function addHit(
  byId: Map<string, DocumentHits>,
  hit: SearchHit,
  sources: MemorySourceIds,
  filter: MemoryHitFilter,
): void {
  const kept = keptHit(hit, sources, filter);

  if (!kept || !hit.externalId) {
    return;
  }
  const found = byId.get(hit.externalId) ?? { hit: kept, chunks: [] };

  byId.set(hit.externalId, found);
  found.chunks.push({ seq: hit.seq, text: hit.text });
}

/** The hit as a memory hit when it is a chunk of this base's memories or episodes source, of an agent the filter allows; the value is filled in once every chunk is known. */
function keptHit(
  hit: SearchHit,
  sources: MemorySourceIds,
  filter: MemoryHitFilter,
): MemorySearchResult | null {
  const parsed = hit.externalId ? memoryExternalId(hit.externalId) : null;

  if (!parsed) {
    return null;
  }
  if (parsed.kind === "memory") {
    const ownSource = hit.sourceId === sources.memories;
    const ownAgent = !filter.agentId || filter.agentId === parsed.agentId;

    return ownSource && ownAgent
      ? {
          key: parsed.key,
          value: "",
          score: hit.score,
          agent_id: parsed.agentId,
          source: "memory",
          backend: "utopia",
        }
      : null;
  }

  return hit.sourceId === sources.episodes && !filter.agentId
    ? {
        key: `episode-${parsed.id}`,
        id: parsed.id,
        value: "",
        score: hit.score,
        agent_id: "",
        source: "episode",
        backend: "utopia",
      }
    : null;
}

function withValue(document: DocumentHits): MemorySearchResult {
  const texts = [...document.chunks]
    .sort((a, b) => a.seq - b.seq)
    .map((chunk) => chunk.text.trim());
  const joined = [...new Set(texts)].join("\n");

  return {
    ...document.hit,
    value:
      document.hit.source === "memory"
        ? withoutKeyLine(joined, document.hit.key)
        : joined,
  };
}

/** A memory was pushed as `<key>\n\n<value>`; the first chunk carries the key line, later chunks do not. */
function withoutKeyLine(content: string, key: string): string {
  return content.startsWith(`${key}\n`)
    ? content.slice(key.length).trimStart()
    : content;
}

/** The hits scored so the best is 1, as Lore's are. */
export function normalizeHitScores(
  hits: MemorySearchResult[],
): MemorySearchResult[] {
  const best = Math.max(0, ...hits.map((hit) => hit.score));

  return best > 0
    ? hits.map((hit) => ({ ...hit, score: hit.score / best }))
    : hits;
}
