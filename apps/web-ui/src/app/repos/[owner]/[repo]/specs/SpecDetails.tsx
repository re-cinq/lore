"use client";

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import type { Root, Text, Element, ElementContent, RootContent } from "hast";
import { type TestLinkRef } from "@/lib/trace-types";
import { resolveHref } from "@/lib/github-links";
import readme from "../ReadmeBox.module.css";
import styles from "./SpecDetails.module.css";

// Re-exported so existing importers (and tests) of SpecDetails keep working
// after the helper moved to the shared github-links module.
export { resolveHref };

export type StatementState = "tested" | "untested" | "narrative";

export interface StatementInfo {
  ordinal: number;
  text: string;
  kind: string;
  state: StatementState;
  /** Untestable category (intro / vision / limitation / etc.); null for testable. */
  category: string | null;
  /** Parsed test links from the trailing parenthetical; empty for non-tested states. */
  testLinks: TestLinkRef[];
  /** Graph-sourced — the statement's graph node is violated/drifted. */
  drifted?: boolean;
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
 * can still find the prefix as a plain text node. Markdown links contain
 * `()` themselves, so a naive regex misses a parenthesized link target —
 * mirror the shared parser's `findTrailingParenSpan`
 * (libs/shared/src/spec-link-parser.ts): walk backward past trailing
 * whitespace/periods counting paren depth, and strip only a parenthetical
 * that holds at least one markdown link (a prose paren renders as plain
 * text and must stay in the matcher). Accepted unguarded runtime copy:
 * runtime code cannot ride the parity-test pattern (that needs a test-file
 * relative import), so lockstep with the shared scanner is held only by
 * the behavioral fixtures in SpecDetails.test.tsx. */
function matcherText(statementText: string): string {
  let end = statementText.length;

  while (end > 0 && /[\s.]/.test(statementText[end - 1])) {
    end--;
  }

  if (end === 0 || statementText[end - 1] !== ")") {
    return statementText.trim();
  }

  let depth = 1;

  for (let i = end - 2; i >= 0; i--) {
    const c = statementText[i];

    if (c === ")") {
      depth++;
      continue;
    }

    if (c !== "(") {
      continue;
    }
    depth--;

    if (depth > 0) {
      continue;
    }
    const inner = statementText.slice(i + 1, end - 1);

    return /\[[^\]]+\]\([^)]+\)/.test(inner)
      ? statementText.slice(0, i).trim()
      : statementText.trim();
  }

  return statementText.trim();
}

/** Reduce a statement's markdown to the plain text react-markdown renders:
 * links collapse to their label and emphasis markers vanish — but ONLY
 * outside code spans. Markdown does not process link/emphasis syntax inside
 * backticks, so a code span's content is kept verbatim (e.g. a literal
 * `([label](path#Lline))` example). Used to match a statement whose inline
 * code / bold splits the rendered output across several HAST nodes. */
function plainText(statementText: string): string {
  return matcherText(statementText)
    .split(/(`[^`]*`)/)
    .map((part) =>
      part.startsWith("`") && part.endsWith("`")
        ? part.slice(1, -1)
        : part
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1"),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Concatenate the rendered text of a HAST node and its descendants,
 * whitespace-collapsed — the string a reader actually sees. */
function renderedText(node: ElementContent | RootContent): string {
  if (node.type === "text") {
    return node.value;
  }

  if (node.type === "element" && node.children) {
    return node.children.map(renderedText).join("");
  }

  return "";
}

/** The per-statement, graph-and-state facets that decide how a `<mark>` is
 * tagged. Bundled so a new facet (evidence count, severity, …) adds one field
 * here instead of another positional arg at every call site. */
interface MarkMeta {
  ordinal: number;
  state: StatementState;
  drifted?: boolean;
}

function buildHighlighter(
  statements: {
    ordinal: number;
    text: string;
    state: StatementState;
    drifted?: boolean;
  }[],
) {
  const enriched = statements.map((s) => ({
    ordinal: s.ordinal,
    text: s.text,
    matcher: matcherText(s.text) || s.text,
    plain: plainText(s.text),
    state: s.state,
    drifted: s.drifted,
  }));
  const ordered = [...enriched].sort(
    (a, b) => b.matcher.length - a.matcher.length,
  );
  const used = new Set<number>();

  function markProps(meta: MarkMeta) {
    return {
      className: [
        "stmt",
        `stmt-${meta.state}`,
        ...(meta.drifted ? ["stmt-drifted"] : []),
      ],
      dataOrdinal: String(meta.ordinal),
      dataState: meta.state,
      ...(meta.drifted ? { dataDrifted: "true" } : {}),
    };
  }

  function makeMark(text: string, meta: MarkMeta): Element {
    return {
      type: "element",
      tagName: "mark",
      properties: markProps(meta),
      children: [{ type: "text", value: text }],
    };
  }

  /** Fallback for statements whose inline code / bold splits the rendered
   * text across multiple HAST children: when a block element's full rendered
   * text begins with a statement's plain text, wrap that element's children
   * in a single `<mark>`. Returns true when it claimed the element. */
  function tryBlockMatch(node: Element): boolean {
    if (node.tagName !== "p" && node.tagName !== "li") {
      return false;
    }

    if (!node.children || node.children.length === 0) {
      return false;
    }
    const rendered = renderedText(node).replace(/\s+/g, " ").trim();

    for (const s of ordered) {
      if (used.has(s.ordinal) || !s.plain) {
        continue;
      }

      if (rendered.startsWith(s.plain)) {
        used.add(s.ordinal);
        node.children = [
          {
            type: "element",
            tagName: "mark",
            properties: markProps(s),
            children: node.children,
          },
        ];

        return true;
      }
    }

    return false;
  }

  function processTextNode(node: Text): ElementContent[] | null {
    for (const s of ordered) {
      if (used.has(s.ordinal)) {
        continue;
      }
      const idx = node.value.indexOf(s.matcher);

      if (idx < 0) {
        continue;
      }
      used.add(s.ordinal);
      const before = node.value.slice(0, idx);
      const after = node.value.slice(idx + s.matcher.length);
      const parts: ElementContent[] = [];

      if (before) {
        parts.push({ type: "text", value: before });
      }
      parts.push(makeMark(s.matcher, s));

      if (after) {
        const tail = { type: "text", value: after } as Text;
        const recursed = processTextNode(tail);

        if (recursed) {
          parts.push(...recursed);
        } else {
          parts.push(tail);
        }
      }

      return parts;
    }

    return null;
  }

  function walkElement(node: Element) {
    if (!node.children || node.children.length === 0) {
      return;
    }
    const next: ElementContent[] = [];
    let changed = false;

    for (const child of node.children) {
      if (child.type === "text") {
        const replaced = processTextNode(child);

        if (replaced) {
          next.push(...replaced);
          changed = true;
          continue;
        }
        next.push(child);
        continue;
      }

      if (child.type === "element" && child.tagName !== "mark") {
        walkElement(child);
      }
      next.push(child);
    }

    if (changed) {
      node.children = next;
    }

    // Fallback only when the contiguous-text-node match found nothing here:
    // a statement fragmented by inline code / bold gets a whole-element wrap.
    if (!changed) {
      tryBlockMatch(node);
    }
  }

  return function plugin() {
    return function transformer(tree: Root) {
      // react-markdown re-runs this transform on every render against a fresh
      // tree; the shared matcher state must start empty each time or a second
      // render finds every statement already claimed and wraps nothing.
      used.clear();
      const rootChildren: RootContent[] = [];
      let rootChanged = false;

      for (const child of tree.children) {
        if (child.type === "text") {
          const replaced = processTextNode(child);

          if (replaced) {
            rootChildren.push(...(replaced as RootContent[]));
            rootChanged = true;
            continue;
          }
          rootChildren.push(child);
          continue;
        }

        if (child.type === "element") {
          walkElement(child);
        }
        rootChildren.push(child);
      }

      if (rootChanged) {
        tree.children = rootChildren;
      }
    };
  };
}

/** Presentational inner content of the hover tooltip: the optional drift
 * notice followed by the state-specific block (narrative / untested / tested).
 * SpecDetails owns the positioning wrapper + `role="tooltip"`; this renders
 * only the children. Needs `repo`/`branch` to resolve test-link hrefs. */
function StatementPopover({
  statement,
  repo,
  branch,
}: {
  statement: StatementInfo;
  repo: string;
  branch: string;
}) {
  return (
    <>
      {statement.drifted && (
        <div className={styles.popoverDrift}>
          <strong>Drifted</strong>
          <div className={styles.popoverHint}>
            The implementation changed since the validating test last passed.
          </div>
        </div>
      )}
      {statement.state === "narrative" ? (
        <div className={styles.popoverNarrative}>
          <strong>Narrative</strong>
          {statement.category ? ` · ${statement.category}` : ""}
          <div className={styles.popoverHint}>
            Excluded from the coverage denominator — context, not a verifiable
            requirement.
          </div>
        </div>
      ) : statement.state === "untested" ? (
        <div className={styles.popoverUntested}>
          <strong>Untested</strong>
          <div className={styles.popoverHint}>
            Add an inline test link at end of this statement:{" "}
            <code>([label](path/to/test.ts#L42))</code>
          </div>
        </div>
      ) : (
        <div className={styles.popoverTested}>
          <strong>
            {statement.testLinks.length} test
            {statement.testLinks.length === 1 ? "" : "s"} validate this
          </strong>
          <ul className={styles.popoverTestList}>
            {statement.testLinks.map((t, i) => (
              <li key={`${t.path}-${t.line ?? ""}-${i}`}>
                <a
                  href={
                    resolveHref(
                      `${t.path}${t.line ? `#L${t.line}` : ""}`,
                      repo,
                      branch,
                    ).href
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.label}
                </a>
                <div className={styles.popoverRationale}>
                  {t.path}
                  {t.line ? `:${t.line}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export default function SpecDetails({
  content,
  statements = [],
  repo,
  branch = "main",
}: {
  content: string;
  statements?: StatementInfo[];
  /** owner/name of the spec's repo, used to resolve relative links to GitHub. */
  repo: string;
  branch?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    ordinal: number;
    x: number;
    y: number;
  } | null>(null);

  const statementsByOrdinal = useMemo(() => {
    const m = new Map<number, StatementInfo>();

    for (const s of statements) {
      m.set(s.ordinal, s);
    }

    return m;
  }, [statements]);

  const plugin = useMemo(() => {
    if (statements.length === 0) {
      return null;
    }
    const enriched = statements.map((s) => ({
      ordinal: s.ordinal,
      text: s.text,
      state: s.state,
      drifted: s.drifted,
    }));

    return buildHighlighter(enriched);
  }, [statements]);

  function handleMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "mark[data-ordinal]",
    );

    if (!target) {
      if (hover) {
        setHover(null);
      }

      return;
    }
    const ordinal = Number(target.dataset.ordinal);

    if (!Number.isFinite(ordinal)) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const x = rect.left - (wrapperRect?.left ?? 0);
    const y = rect.bottom - (wrapperRect?.top ?? 0) + 6;

    setHover({ ordinal, x, y });
  }

  function handleMouseLeave() {
    setHover(null);
  }

  const sanitize = [rehypeSanitize, markdownSanitizeSchema] as const;
  const rehypePlugins = plugin
    ? [rehypeRaw, sanitize, plugin]
    : [rehypeRaw, sanitize];
  const hovered = hover ? statementsByOrdinal.get(hover.ordinal) : null;

  // Rewrite repo-relative markdown links (test links, ADR/doc refs) to GitHub
  // so they resolve and open in a new tab instead of a dead in-app href.
  const mdComponents = useMemo(
    () => ({
      a(props: React.ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
        const { href, children, node: _node, ...rest } = props;
        const { href: resolved, external } = resolveHref(
          href ?? "",
          repo,
          branch,
        );
        const ext = external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {};

        return (
          <a href={resolved} {...ext} {...rest}>
            {children}
          </a>
        );
      },
    }),
    [repo, branch],
  );

  return (
    <div>
      <div
        ref={wrapperRef}
        className={`${readme.readme} ${styles.specBody}`}
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rehypePlugins={rehypePlugins as any}
          components={mdComponents}
        >
          {content}
        </ReactMarkdown>
        {hover && hovered && (
          <div
            className={styles.popover}
            style={{ left: hover.x, top: hover.y }}
            role="tooltip"
          >
            <StatementPopover statement={hovered} repo={repo} branch={branch} />
          </div>
        )}
      </div>
    </div>
  );
}
