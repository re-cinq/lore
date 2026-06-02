'use client';

import { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { Root, Text, Element, ElementContent, RootContent } from 'hast';
import readme from '../ReadmeBox.module.css';
import styles from './SpecDetails.module.css';

export interface TestLink {
  name: string;
  file_path: string;
  line: number | null;
  symbol: string | null;
  match_kind: string;
  rationale: string;
  statement_ordinal: number | null;
  match_score: number | null;
  url: string;
}

export interface StatementInfo {
  ordinal: number;
  text: string;
  kind: string;
  testability: string;
  category: string | null;
}

type State = 'tested' | 'untested' | 'narrative';

function shortFile(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

interface AnchoredOrdinals {
  matched: Set<number>;
}

/**
 * Rehype plugin: walk text nodes, for each testable statement try to find a
 * contiguous substring match in a single text node. When found, split the
 * text node into [before, <mark data-ordinal class>, after]. Statements
 * crossing inline formatting (bold / code / links) won't anchor — the always-
 * present test list below is the fallback so no link is silently lost.
 */
function buildHighlighter(
  statements: { ordinal: number; text: string; state: State }[],
  out: AnchoredOrdinals,
) {
  // Match longer statements first so a long statement isn't pre-empted by a
  // shorter one whose text happens to be a prefix.
  const ordered = [...statements].sort((a, b) => b.text.length - a.text.length);

  function makeMark(text: string, ordinal: number, state: State): Element {
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
      const idx = node.value.indexOf(s.text);
      if (idx < 0) continue;
      out.matched.add(s.ordinal);
      const before = node.value.slice(0, idx);
      const after = node.value.slice(idx + s.text.length);
      const parts: ElementContent[] = [];
      if (before) parts.push({ type: 'text', value: before });
      parts.push(makeMark(s.text, s.ordinal, s.state));
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

function statementState(s: StatementInfo, covered: Set<number>): State {
  if (s.testability === 'untestable') return 'narrative';
  return covered.has(s.ordinal) ? 'tested' : 'untested';
}

export default function SpecDetails({
  content,
  tests,
  statements = [],
}: {
  content: string;
  tests: TestLink[];
  statements?: StatementInfo[];
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ ordinal: number; x: number; y: number } | null>(null);

  const coveredOrdinals = useMemo(
    () => new Set(tests.map((t) => t.statement_ordinal).filter((o): o is number => o !== null)),
    [tests],
  );

  const testsByOrdinal = useMemo(() => {
    const m = new Map<number, TestLink[]>();
    for (const t of tests) {
      if (t.statement_ordinal === null) continue;
      const list = m.get(t.statement_ordinal) ?? [];
      list.push(t);
      m.set(t.statement_ordinal, list);
    }
    return m;
  }, [tests]);

  const statementsByOrdinal = useMemo(() => {
    const m = new Map<number, StatementInfo>();
    for (const s of statements) m.set(s.ordinal, s);
    return m;
  }, [statements]);

  const anchored = useMemo<AnchoredOrdinals>(() => ({ matched: new Set() }), [statements, content]);

  const plugin = useMemo(() => {
    if (statements.length === 0) return null;
    const enriched = statements.map((s) => ({
      ordinal: s.ordinal,
      text: s.text,
      state: statementState(s, coveredOrdinals),
    }));
    return buildHighlighter(enriched, anchored);
  }, [statements, coveredOrdinals, anchored]);

  const unanchoredOrdinals = useMemo(() => {
    if (statements.length === 0) return new Set<number>();
    const all = new Set(statements.map((s) => s.ordinal));
    for (const m of anchored.matched) all.delete(m);
    return all;
  }, [anchored, statements, plugin]);

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
  const hoveredTests = hover ? testsByOrdinal.get(hover.ordinal) ?? [] : [];

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
          <div
            className={styles.popover}
            style={{ left: hover.x, top: hover.y }}
            role="tooltip"
          >
            {hovered.testability === 'untestable' ? (
              <div className={styles.popoverNarrative}>
                <strong>Narrative</strong>{hovered.category ? ` · ${hovered.category}` : ''}
                <div className={styles.popoverHint}>
                  Excluded from the coverage denominator — context, not a verifiable requirement.
                </div>
              </div>
            ) : hoveredTests.length === 0 ? (
              <div className={styles.popoverUntested}>
                <strong>Untested</strong>
                <div className={styles.popoverHint}>
                  This is a testable statement with no test linked to it yet.
                </div>
              </div>
            ) : (
              <div className={styles.popoverTested}>
                <strong>{hoveredTests.length} test{hoveredTests.length === 1 ? '' : 's'} validate this</strong>
                <ul className={styles.popoverTestList}>
                  {hoveredTests.map((t, i) => (
                    <li key={`${t.file_path}-${t.name}-${i}`}>
                      <a href={t.url} target="_blank" rel="noreferrer">{t.name}</a>
                      <div className={styles.popoverRationale}>{t.rationale}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <h3 style={{ marginTop: 24 }}>Tests validating this spec ({tests.length})</h3>
      {tests.length === 0 ? (
        <p className="meta">○ No tests linked to this spec yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {tests.map((test, i) => {
            const ordinal = test.statement_ordinal;
            const listOnly = ordinal !== null && unanchoredOrdinals.has(ordinal);
            const legacyRow = ordinal === null;
            return (
              <li key={`${test.file_path}-${test.name}-${i}`} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
                <details>
                  <summary style={{ display: 'flex', justifyContent: 'space-between', gap: 12, cursor: 'pointer', alignItems: 'baseline' }}>
                    <span>
                      {test.name}
                      {listOnly && <span className={styles.listOnlyTag} title="Validated statement could not be anchored inline (likely formatting-mixed)"> · list-only</span>}
                      {legacyRow && <span className={styles.listOnlyTag} title="Pre-v2 link without a statement ordinal — degrades to list-only until the spec is re-linked"> · legacy</span>}
                    </span>
                    <a
                      href={test.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {shortFile(test.file_path)}{test.line ? `:${test.line}` : ''} ↗
                    </a>
                  </summary>
                  <div className="meta" style={{ marginTop: 6, paddingLeft: 16 }}>
                    └ judge: {test.rationale}
                    {test.symbol && <> · symbol: <code>{test.symbol}</code></>}
                    {' · match: '}{test.match_kind}
                    {test.match_score !== null && <> · score: {test.match_score.toFixed(2)}</>}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
