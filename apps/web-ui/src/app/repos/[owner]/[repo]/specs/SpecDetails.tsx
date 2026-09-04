"use client";

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { type TestLinkRef } from "@/lib/trace-types";
import { resolveHref } from "@/lib/github-links";
import { buildHighlighter } from "./statement-highlight";
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

interface SpecDetailsProps {
  content: string;
  statements?: StatementInfo[];
  /** owner/name of the spec's repo, used to resolve relative links to GitHub. */
  repo: string;
  branch?: string;
}

function resolveSpecDetailsProps(props: SpecDetailsProps) {
  return {
    content: props.content,
    statements: props.statements ?? [],
    repo: props.repo,
    branch: props.branch ?? "main",
  };
}

export default function SpecDetails(props: SpecDetailsProps) {
  const { content, statements, repo, branch } = resolveSpecDetailsProps(props);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { hover, onMouseOver, onMouseLeave } = useStatementHover(wrapperRef);
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

  const sanitize = [rehypeSanitize, markdownSanitizeSchema] as const;
  const rehypePlugins = plugin
    ? [rehypeRaw, sanitize, plugin]
    : [rehypeRaw, sanitize];
  const hovered = hover ? statementsByOrdinal.get(hover.ordinal) : null;

  const mdComponents = useGithubLinks(repo, branch);

  return (
    <div>
      <div
        ref={wrapperRef}
        className={`${readme.readme} ${styles.specBody}`}
        onMouseOver={onMouseOver}
        onMouseLeave={onMouseLeave}
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

/** Tooltip anchor for `target`, measured against the wrapper so the popover sits with the text rather than the viewport. */
function tooltipPosition(
  target: HTMLElement,
  wrapperRef: React.RefObject<HTMLDivElement | null>,
): { left: number; top: number } {
  const rect = target.getBoundingClientRect();
  const wrapperRect = wrapperRef.current?.getBoundingClientRect();

  return {
    left: rect.left - (wrapperRect?.left ?? 0),
    top: rect.bottom - (wrapperRect?.top ?? 0) + 6,
  };
}

/** Which highlighted statement the pointer is over, and where to put its tooltip — measured against the wrapper, so the popover sits with the text rather than the viewport. */
function useStatementHover(wrapperRef: React.RefObject<HTMLDivElement | null>) {
  const [hover, setHover] = useState<{
    ordinal: number;
    x: number;
    y: number;
  } | null>(null);

  function onMouseOver(e: React.MouseEvent<HTMLDivElement>) {
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
    const { left, top } = tooltipPosition(target, wrapperRef);

    setHover({ ordinal, x: left, y: top });
  }

  function onMouseLeave() {
    setHover(null);
  }

  return { hover, onMouseOver, onMouseLeave };
}

/** Markdown links resolve against the spec's own repo and branch; anything that leaves the app opens in a new tab. */
function useGithubLinks(repo: string, branch: string) {
  // Rewrite markdown links to GitHub: open externally instead of in-app.
  return useMemo(
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
}
