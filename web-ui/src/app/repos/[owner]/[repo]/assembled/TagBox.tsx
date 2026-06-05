'use client';

import Markdown from '@/components/Markdown';
import type { TagNode } from './tag-tree';

/** The monospace attribute chip that straddles the top border of each box —
 *  black "terminal readout" with a colored tag name and green attribute values. */
function TagChip({ tag, attrs }: { tag: string; attrs: [string, string][] }) {
  return (
    <span
      style={{
        position: 'absolute',
        top: '-10px',
        left: '12px',
        maxWidth: 'calc(100% - 24px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        padding: '1px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--hud-chip-bg)',
        color: 'var(--hud-chip-fg)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
      }}
    >
      <span style={{ color: 'var(--hud-chip-tag)' }}>{tag}</span>
      {attrs.map(([k, v]) => (
        <span key={k}>
          {' '}
          {k}=<span style={{ color: 'var(--hud-chip-attr)' }}>&quot;{v}&quot;</span>
        </span>
      ))}
    </span>
  );
}

/** Recursive nested-box renderer: each tag is a bordered div containing its
 *  children (or, at a leaf `document`, its content as markdown or raw text). */
export default function TagBox({ node, raw, depth = 0 }: { node: TagNode; raw: boolean; depth?: number }) {
  const isLeaf = node.content !== undefined;
  return (
    <div
      style={{
        position: 'relative',
        marginTop: '16px',
        padding: '18px 12px 12px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: depth % 2 === 1 ? 'var(--bg)' : 'var(--bg-surface)',
      }}
    >
      <TagChip tag={node.tag} attrs={node.attrs} />
      {isLeaf ? (
        raw ? (
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)' }}>
            {node.content}
          </pre>
        ) : (
          <Markdown markdown={node.content ?? ''} />
        )
      ) : (
        node.children?.map((child, i) => <TagBox key={i} node={child} raw={raw} depth={depth + 1} />)
      )}
    </div>
  );
}
