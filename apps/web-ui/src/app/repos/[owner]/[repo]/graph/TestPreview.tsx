"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

/**
 * Lazily fetches a TestChunk's source slice and renders it as a highlighted code
 * block. Language-agnostic: the text is wrapped in a bare ``` fence so
 * highlight.js auto-detects the language — works for any toolchain.
 */
export default function TestPreview({
  repo,
  path,
  start,
  end,
}: {
  repo: string;
  path: string;
  start: number;
  end?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      path,
      start: String(start),
      ...(end ? { end: String(end) } : {}),
    });

    fetch(`/api/repos/${repo}/file?${params.toString()}`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error("unavailable")),
      )
      .then((json: { text: string }) => {
        if (!cancelled) {
          setText(json.text);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repo, path, start, end]);

  if (error) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>
        Preview unavailable.
      </div>
    );
  }

  if (text === null) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>
        Loading preview…
      </div>
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
