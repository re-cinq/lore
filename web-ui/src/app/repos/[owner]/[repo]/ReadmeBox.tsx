'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import styles from './ReadmeBox.module.css';

function resolveUrl(url: string, base: string): string {
  if (/^(https?:|mailto:|data:|#)/i.test(url) || !base) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function splitBlocks(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean);
}

export default function ReadmeBox({
  markdown,
  rawBaseUrl,
  htmlUrl,
}: {
  markdown: string;
  rawBaseUrl: string;
  htmlUrl: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const blocks = splitBlocks(markdown);
  const collapsible = blocks.length > 2;
  const visible = expanded || !collapsible ? markdown : blocks.slice(0, 2).join('\n\n');

  const urlTransform = (url: string, key: string) =>
    resolveUrl(url, key === 'src' ? rawBaseUrl : htmlUrl);

  return (
    <div className={styles.readme}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        urlTransform={urlTransform}
      >
        {visible}
      </ReactMarkdown>
      {collapsible && (
        <button
          type="button"
          className="btn-secondary"
          style={{ marginTop: '12px' }}
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
