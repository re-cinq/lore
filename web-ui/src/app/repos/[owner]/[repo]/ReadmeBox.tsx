'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import styles from './ReadmeBox.module.css';
import { resolveUrl, splitBlocks } from './readme-markdown';

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
