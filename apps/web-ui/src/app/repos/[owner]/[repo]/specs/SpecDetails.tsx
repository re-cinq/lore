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

// Re-exported for backward compatibility (helper moved to github-links module).
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

/** v3: wraps statements in <mark> by test-link state; inline formatting falls back gracefully. */
/** Strip trailing paren when react-markdown breaks test-link into `<a>` element. */
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

/** Markdown to plain text: collapse links, strip emphasis outside code, keep code spans verbatim. */
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

/** Rendered text of HAST node and descendants, whitespace-collapsed. */
function renderedText(node: ElementContent | RootContent): string {
  if (node.type === "text") {
    return node.value;
  }

  if (node.type === "element" && node.children) {
    return node.children.map(renderedText).join("");
  }

  return "";
}

/** Per-statement facets (ordinal, state, drifted) bundled to avoid positional args at call sites. */
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

  /** Fallback: wrap element's children when its rendered text matches a statement (split by code/bold). */
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

        parts.push(...(recursed ?? [tail]));
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

    node.children.forEach((child) => {
      if (child.type === "element" && child.tagName !== "mark") {
        walkElement(child);
      }

      if (child.type !== "text") {
        next.push(child);

        return;
      }
      const replaced = processTextNode(child);

      if (replaced) {
        next.push(...replaced);
        changed = true;

        return;
      }
      next.push(child);
    });

    if (changed) {
      node.children = next;
    }

    // Fallback: whole-element wrap when contiguous-text-node match finds nothing (e.g. fragmented by inline code).
    if (!changed) {
      tryBlockMatch(node);
    }
  }

  return function plugin() {
    return function transformer(tree: Root) {
      // react-markdown re-runs on every render with fresh tree; clear matcher state to avoid re-claimed statements.
      used.clear();
      const rootChildren: RootContent[] = [];
      let rootChanged = false;

      tree.children.forEach((child) => {
        if (child.type === "element") {
          walkElement(child);
        }

        if (child.type !== "text") {
          rootChildren.push(child);

          return;
        }
        const replaced = processTextNode(child);

        if (replaced) {
          rootChildren.push(...(replaced as RootContent[]));
          rootChanged = true;

          return;
        }
        rootChildren.push(child);
      });

      if (rootChanged) {
        tree.children = rootChildren;
      }
    };
  };
}

/** Tooltip inner content: drift notice + state block (narrative/untested/tested); needs repo/branch for links. */
function StatementPopover({
  statement,
  repo,
  branch,
}: {
  statement: StatementInfo;
  repo: string;
  branch: string;
}) {
  const renderStateBlock = () => {
    if (statement.state === "narrative") {
      return (
        <div className={styles.popoverNarrative}>
          <strong>Narrative</strong>
          {statement.category ? ` · ${statement.category}` : ""}
          <div className={styles.popoverHint}>
            Excluded from the coverage denominator — context, not a verifiable
            requirement.
          </div>
        </div>
      );
    }

    if (statement.state === "untested") {
      return (
        <div className={styles.popoverUntested}>
          <strong>Untested</strong>
          <div className={styles.popoverHint}>
            Add an inline test link at end of this statement:{" "}
            <code>([label](path/to/test.ts#L42))</code>
          </div>
        </div>
      );
    }

    return (
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
    );
  };

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
      {renderStateBlock()}
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

    if (!target && hover) {
      setHover(null);
    }

    if (!target) {
      return;
    }
    const ordinal = Number(target.dataset.ordinal);

    if (!Number.isFinite(ordinal)) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const left = rect.left - (wrapperRect?.left ?? 0);
    const top = rect.bottom - (wrapperRect?.top ?? 0) + 6;

    setHover({ ordinal, x: left, y: top });
  }

  function handleMouseLeave() {
    setHover(null);
  }

  const sanitize = [rehypeSanitize, markdownSanitizeSchema] as const;
  const rehypePlugins = plugin
    ? [rehypeRaw, sanitize, plugin]
    : [rehypeRaw, sanitize];
  const hovered = hover ? statementsByOrdinal.get(hover.ordinal) : null;

  // Rewrite markdown links to GitHub: open externally instead of in-app.
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
            style={{
              ["--popover-x" as string]: `${hover.x}px`,
              ["--popover-y" as string]: `${hover.y}px`,
            }}
            role="tooltip"
          >
            <StatementPopover statement={hovered} repo={repo} branch={branch} />
          </div>
        )}
      </div>
    </div>
  );
}
