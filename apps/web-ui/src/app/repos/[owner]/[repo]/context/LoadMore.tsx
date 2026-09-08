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

  try {
    const res = await fetch(`/api/repos/${owner}/${repo}/context?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });

    return res.ok ? ((await res.json()) as ContextPage) : null;
  } catch {
    return null;
  }
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

interface PagerSetters {
  setChunks: React.Dispatch<React.SetStateAction<ContextCardChunk[]>>;
  setOffset: React.Dispatch<React.SetStateAction<number>>;
  setMore: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Folds one fetch result into the pager. A failed page leaves `more` alone: the chunks past this offset still exist, so the button stays rather than telling the reader the list is complete. */
function applyPage(page: ContextPage | null, setters: PagerSetters) {
  if (page === null) {
    return;
  }
  setters.setChunks((prev) => [...prev, ...page.chunks]);
  setters.setOffset((prev) => prev + CONTEXT_PAGE_SIZE);
  setters.setMore(page.hasMore);
}

/** Asks for the next page. Disabled while a request is in flight so a second click cannot append the same offset twice. */
function MoreButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="load-more"
      onClick={onClick}
      disabled={loading}
    >
      {loading ? "Loading…" : "Load more"}
    </button>
  );
}

/** Client-side pager for per-repo context list; appends pages on demand to keep initial load small. */
export default function LoadMore(props: LoadMoreProps) {
  const { owner, repo, q, type, initialOffset, hasMore } = props;
  const [chunks, setChunks] = useState<ContextCardChunk[]>([]);
  const [offset, setOffset] = useState(initialOffset);
  const [more, setMore] = useState(hasMore);
  const [loading, setLoading] = useState(false);

  const loadMore = async () => {
    setLoading(true);
    const page = await fetchContextPage({ owner, repo, q, type, offset });

    setLoading(false);
    applyPage(page, { setChunks, setOffset, setMore });
  };

  return (
    <>
      <ContextCards
        chunks={chunks}
        owner={owner}
        repo={repo}
        base={`/repos/${owner}/${repo}/context`}
      />
      {more && <MoreButton loading={loading} onClick={() => void loadMore()} />}
    </>
  );
}
