'use client';

import { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { Root, Text, Element, ElementContent, RootContent } from 'hast';
import { type TestLinkRef } from '@/lib/spec-link-parser';
import readme from '../ReadmeBox.module.css';
import styles from './SpecDetails.module.css';

export type StatementState = 'tested' | 'untested' | 'narrative';

export interface StatementInfo {
  ordinal: number;
  text: string;
  kind: string;
  state: StatementState;
  /** Untestable category (intro / vision / limitation / etc.); null for testable. */
  category: string | null;
  /** Parsed test links from the trailing parenthetical; empty for non-tested states. */
  testLinks: TestLinkRef[];
}

/**
 * v3 SpecDetails renders the spec markdown and wraps each statement
 * in `<mark>` with a state class derived from the author's inline
 * test links. The author's `[label](path#Lline)` markdown links
 * inside the trailing parenthetical of a statement keep their normal
 * `<a>` rendering; the visual "this is a test link" cue comes from
 * the surrounding statement wrap, not from special anchor styling.
 *
 * Statements that cross inline formatting (bold / inline code) won't
 * match exactly against a single text node and silently fall back to
 * "no wrap" — the rehype walker must not throw. The author can still
 * see the test link as a plain anchor; the CoverageBar at the top of
 * the page still counts it because the page handler computed state
 * from the raw markdown, not from the rendered HTML.
 */
/** A v3 statement may end with a trailing markdown test-link paren that
 * react-markdown breaks into an `<a>` element — so the raw statement text
 * won't be a contiguous text node. Strip the trailing paren so the matcher
 * can still find the prefix as a plain text node. */
function matcherText(statementText: string): string {
  return statementText
    .replace(/\s*\(\s*\[[^\]]+\]\([^)]+\)(?:\s*,\s*\[[^\]]+\]\([^)]+\))*\s*\)\s*\.?\s*$/, '')
    .trim();
}

function buildHighlighter(
  statements: { ordinal: number; text: string; state: StatementState }[],
) {
  const enriched = statements.map((s) => ({
    ordinal: s.ordinal,
    text: s.text,
    matcher: matcherText(s.text) || s.text,
    state: s.state,
  }));
  const ordered = [...enriched].sort((a, b) => b.matcher.length - a.matcher.length);

  function makeMark(text: string, ordinal: number, state: StatementState): Element {
    return {
      type: 'element',
      tagName: 'mark',
      properties: {
        className: ['stmt', `stmt-${state}`],
        dataOrdinal: String(ordinal),
        dataState: state,
      },
      children: [{ type: 'text', value: text }],
    };
  }

  function processTextNode(node: Text): ElementContent[] | null {
    for (const s of ordered) {
      const idx = node.value.indexOf(s.matcher);
      if (idx < 0) continue;
      const before = node.value.slice(0, idx);
      const after = node.value.slice(idx + s.matcher.length);
      const parts: ElementContent[] = [];
      if (before) parts.push({ type: 'text', value: before });
      parts.push(makeMark(s.matcher, s.ordinal, s.state));
      if (after) {
        const tail = { type: 'text', value: after } as Text;
        const recursed = processTextNode(tail);
        if (recursed) parts.push(...recursed);
        else parts.push(tail);
      }
      return parts;
    }
    return null;
  }

  function walkElement(node: Element) {
    if (!node.children || node.children.length === 0) return;
    const next: ElementContent[] = [];
    let changed = false;
    for (const child of node.children) {
      if (child.type === 'text') {
        const replaced = processTextNode(child);
        if (replaced) {
          next.push(...replaced);
          changed = true;
          continue;
        }
        next.push(child);
        continue;
      }
      if (child.type === 'element' && child.tagName !== 'mark') {
        walkElement(child);
      }
      next.push(child);
    }
    if (changed) node.children = next;
  }

  return function plugin() {
    return function transformer(tree: Root) {
      const rootChildren: RootContent[] = [];
      let rootChanged = false;
      for (const child of tree.children) {
        if (child.type === 'text') {
          const replaced = processTextNode(child);
          if (replaced) {
            rootChildren.push(...(replaced as RootContent[]));
            rootChanged = true;
            continue;
          }
          rootChildren.push(child);
          continue;
        }
        if (child.type === 'element') walkElement(child);
        rootChildren.push(child);
      }
      if (rootChanged) tree.children = rootChildren;
    };
  };
}

export default function SpecDetails({
  content,
  statements = [],
}: {
  content: string;
  statements?: StatementInfo[];
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ ordinal: number; x: number; y: number } | null>(null);

  const statementsByOrdinal = useMemo(() => {
    const m = new Map<number, StatementInfo>();
    for (const s of statements) m.set(s.ordinal, s);
    return m;
  }, [statements]);

  const plugin = useMemo(() => {
    if (statements.length === 0) return null;
    const enriched = statements.map((s) => ({
      ordinal: s.ordinal,
      text: s.text,
      state: s.state,
    }));
    return buildHighlighter(enriched);
  }, [statements]);

  function handleMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>('mark[data-ordinal]');
    if (!target) {
      if (hover) setHover(null);
      return;
    }
    const ordinal = Number(target.dataset.ordinal);
    if (!Number.isFinite(ordinal)) return;
    const rect = target.getBoundingClientRect();
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const x = rect.left - (wrapperRect?.left ?? 0);
    const y = rect.bottom - (wrapperRect?.top ?? 0) + 6;
    setHover({ ordinal, x, y });
  }

  function handleMouseLeave() {
    setHover(null);
  }

  const rehypePlugins = plugin ? [rehypeRaw, plugin] : [rehypeRaw];
  const hovered = hover ? statementsByOrdinal.get(hover.ordinal) : null;

  return (
    <div>
      <div
        ref={wrapperRef}
        className={`${readme.readme} ${styles.specBody}`}
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
        style={{ position: 'relative' }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rehypePlugins={rehypePlugins as any}
        >
          {content}
        </ReactMarkdown>
        {hover && hovered && (
          <div className={styles.popover} style={{ left: hover.x, top: hover.y }} role="tooltip">
            {hovered.state === 'narrative' ? (
              <div className={styles.popoverNarrative}>
                <strong>Narrative</strong>{hovered.category ? ` · ${hovered.category}` : ''}
                <div className={styles.popoverHint}>
                  Excluded from the coverage denominator — context, not a verifiable requirement.
                </div>
              </div>
            ) : hovered.state === 'untested' ? (
              <div className={styles.popoverUntested}>
                <strong>Untested</strong>
                <div className={styles.popoverHint}>
                  Add an inline test link at end of this statement:{' '}
                  <code>([label](path/to/test.ts#L42))</code>
                </div>
              </div>
            ) : (
              <div className={styles.popoverTested}>
                <strong>
                  {hovered.testLinks.length} test{hovered.testLinks.length === 1 ? '' : 's'} validate this
                </strong>
                <ul className={styles.popoverTestList}>
                  {hovered.testLinks.map((t, i) => (
                    <li key={`${t.path}-${t.line ?? ''}-${i}`}>
                      <a
                        href={`${t.path}${t.line ? `#L${t.line}` : ''}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.label}
                      </a>
                      <div className={styles.popoverRationale}>
                        {t.path}{t.line ? `:${t.line}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
