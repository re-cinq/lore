"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

interface FileSliceRange {
  repo: string;
  path: string;
  start: number;
  end?: number;
}

/** Fetches test source slice and renders as highlighted code; language auto-detected via fence. */
export default function TestPreview({
  repo,
  path,
  start,
  end,
}: FileSliceRange) {
  const { text, error } = useFileSlice(repo, path, start, end);

  if (error || text === null) {
    return (
      <PreviewNote text={error ? "Preview unavailable." : "Loading preview…"} />
    );
  }

  return (
    <div className="md-popover" style={{ fontSize: "var(--fs-xs)" }}>
      <ReactMarkdown
        rehypePlugins={[rehypeHighlight]}
      >{`\`\`\`\n${text}\n\`\`\``}</ReactMarkdown>
    </div>
  );
}

function PreviewNote({ text }: { text: string }) {
  return (
    <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>
      {text}
    </div>
  );
}

/** The lines this test occupies, fetched from the repo. */
function useFileSlice(repo: string, path: string, start: number, end?: number) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(
    () => loadSlice({ repo, path, start, end }, setText, () => setError(true)),
    [repo, path, start, end],
  );

  return { text, error };
}

/** Starts the fetch and returns the cleanup. `cancelled` guards the setState rather than aborting the request: the popover unmounts as soon as the pointer leaves, and a half-finished fetch is cheaper to ignore than to tear down. */
function loadSlice(
  range: FileSliceRange,
  onText: (slice: string) => void,
  onError: () => void,
): () => void {
  let cancelled = false;
  const ifLive = (fn: () => void) => {
    if (!cancelled) {
      fn();
    }
  };

  fetchSlice(range)
    .then((slice) => ifLive(() => onText(slice)))
    .catch(() => ifLive(onError));

  return () => {
    cancelled = true;
  };
}

/** One slice of a repo file. An open-ended range is sent without `end`, which the route reads as "to the end of the symbol" rather than as line zero. */
async function fetchSlice({
  repo,
  path,
  start,
  end,
}: FileSliceRange): Promise<string> {
  const params = new URLSearchParams({
    path,
    start: String(start),
    ...(end ? { end: String(end) } : {}),
  });
  const res = await fetch(`/api/repos/${repo}/file?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error("unavailable");
  }

  return ((await res.json()) as { text: string }).text;
}
