// Lore's memories and episodes as the documents an `api` source of a Utopia knowledge base takes (specs/utopia-graph-mirror FR16): Utopia extracts its own facts and graph from them, so nothing but the text and its identity travels.

/** Utopia's `IngestBody`: with `external_id` the identity is declared, so the same id with new content updates the document in place and `deleted` tombstones it. */
export interface IngestDocument {
  external_id: string;
  filename: string;
  content?: string;
  doc_time?: string;
  deleted?: boolean;
}

export interface MirroredMemory {
  agentId: string;
  key: string;
  value: string;
  createdAt: string;
  /** False once the memory is deleted, evicted or past its expiry. */
  live: boolean;
}

export interface MirroredEpisode {
  id: string;
  content: string;
  createdAt: string;
}

/** The key leads the content, so two memories holding the same value never read as one document's content. */
export function memoryDocument(memory: MirroredMemory): IngestDocument {
  const identity = {
    external_id: `memory:${memory.agentId}/${memory.key}`,
    filename: memory.key,
  };

  return memory.live
    ? {
        ...identity,
        content: `${memory.key}\n\n${memory.value}`,
        doc_time: memory.createdAt,
      }
    : { ...identity, deleted: true };
}

export function episodeDocument(episode: MirroredEpisode): IngestDocument {
  return {
    external_id: `episode:${episode.id}`,
    filename: `episode-${episode.id}`,
    content: episode.content,
    doc_time: episode.createdAt,
  };
}

/** The `owner/repo` a ref starts with: a bare repo, a task path under it, `#<n>` after it, or a `session:` ref. The walk's SQL matches with the same pattern, so a live push and the walk send an episode to the same base. */
export const REF_REPO_PATTERN = "^(?:session:)?([^/#\\s:]+/[^/#\\s]+)";

const refRepo = new RegExp(REF_REPO_PATTERN);

export function repoOfRef(ref: string | null): string | null {
  return ref?.match(refRepo)?.[1] ?? null;
}
