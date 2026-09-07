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

/** Client-side pager for per-repo context list; appends pages on demand to keep initial load small. */
/** One page of a repo's context. Returns null on a failed request rather than throwing: the button re-enables and the reader can try again, which is a better answer than an error where a list was expected. */
async function fetchContextPage({
  owner,
  repo,
  q,
  type,
  offset,
}: {
  owner: string;
  repo: string;
  q?: string;
  type?: string;
  offset: number;
}): Promise<ContextPage | null> {
  const params = new URLSearchParams({ offset: String(offset) });

  if (q) {
    params.set("q", q);
  }

  if (type) {
    params.set("type", type);
  }
  const res = await fetch(`/api/repos/${owner}/${repo}/context?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });

  return res.ok ? ((await res.json()) as ContextPage) : null;
}

/** The pages loaded since the server's first render; the server-rendered ones sit above this component. */
function ContextCards({
  chunks,
  owner,
  repo,
  base,
}: {
  chunks: ContextCardChunk[];
  owner: string;
  repo: string;
  base: string;
}) {
  return (
    <>
      {chunks.map((c) => (
        <ContextCard
          key={c.id}
          chunk={c}
          repo={`${owner}/${repo}`}
          detailHref={
            c.file_path
              ? `${base}/${encodeURIComponent(c.file_path)}`
              : undefined
          }
        />
      ))}
    </>
  );
}

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
      const page = await fetchContextPage({ owner, repo, q, type, offset });

      if (page === null) {
        return;
      }

      setChunks((prev) => [...prev, ...page.chunks]);
      setOffset((prev) => prev + CONTEXT_PAGE_SIZE);
      setMore(page.hasMore);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ContextCards chunks={chunks} owner={owner} repo={repo} base={base} />
      {more && (
        <button
          type="button"
          className="load-more"
          onClick={() => void loadMore()}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
