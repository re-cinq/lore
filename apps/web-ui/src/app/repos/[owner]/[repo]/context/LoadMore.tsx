"use client";

import { useState } from "react";
import ContextCard, { type ContextCardChunk } from "./ContextCard";
import { CONTEXT_PAGE_SIZE } from "./pagination";

export interface LoadMoreProps {
  owner: string;
  repo: string;
  /** Active keyword query, preserved across paged fetches. */
  q?: string;
  /** Active content_type filter, preserved across paged fetches. */
  type?: string;
  /** Rows already rendered server-side — where the next fetch starts. */
  initialOffset: number;
  /** Whether a further page exists after the server-rendered first page. */
  hasMore: boolean;
}

interface ContextPage {
  chunks: ContextCardChunk[];
  hasMore: boolean;
}

/**
 * Client-side pager for the per-repo context list. The first page is rendered
 * server-side; this appends subsequent pages on demand from the context API
 * route so the initial load stays small.
 */
export default function LoadMore({
  owner,
  repo,
  q,
  type,
  initialOffset,
  hasMore,
}: LoadMoreProps) {
  const [chunks, setChunks] = useState<ContextCardChunk[]>([]);
  const [offset, setOffset] = useState(initialOffset);
  const [more, setMore] = useState(hasMore);
  const [loading, setLoading] = useState(false);

  const base = `/repos/${owner}/${repo}/context`;

  const loadMore = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ offset: String(offset) });
      if (q) params.set("q", q);
      if (type) params.set("type", type);
      const res = await fetch(`/api/repos/${owner}/${repo}/context?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as ContextPage;
      setChunks((prev) => [...prev, ...data.chunks]);
      setOffset((prev) => prev + CONTEXT_PAGE_SIZE);
      setMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {chunks.map((c) => (
        <ContextCard
          key={c.id}
          chunk={c}
          repo={`${owner}/${repo}`}
          detailHref={`${base}/${encodeURIComponent(c.file_path)}`}
        />
      ))}
      {more && (
        <button
          type="button"
          className="load-more"
          onClick={loadMore}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
