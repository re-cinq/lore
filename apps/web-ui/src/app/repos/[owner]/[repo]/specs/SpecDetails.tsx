"use client";

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { type StatementInfo, type StatementState } from "@/lib/trace-types";

export type { StatementInfo, StatementState };
import { resolveHref } from "@/lib/github-links";
import { useResolvedMarkdownLinks } from "@/app/repos/[owner]/[repo]/useResolvedMarkdownLinks";
import { buildHighlighter } from "./statement-highlight";
import readme from "../ReadmeBox.module.css";
import styles from "./SpecDetails.module.css";
import { StatementPopover } from "./StatementPopover";

// Re-exported for backward compatibility (helper moved to github-links module).
export { resolveHref };

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

/** The markdown pipeline for a spec: an ordinal lookup for the hover, and the rehype chain that highlights each statement by its coverage state. Sanitisation sits BETWEEN raw HTML and the highlighter — raw first so a spec's own markup renders, sanitize next so it cannot inject, and the highlighter last because it only adds attributes to nodes that already survived. */
function useStatementHighlighting(statements: StatementInfo[]) {
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

  return { statementsByOrdinal, rehypePlugins };
}

/** The spec itself, with the statement-highlighting plugins applied. Those plugins are what put the hover targets in the rendered HTML, so the popover has something to attach to. */
function SpecMarkdown({
  content,
  rehypePlugins,
  components,
}: {
  content: string;
  rehypePlugins: ReturnType<typeof useStatementHighlighting>["rehypePlugins"];
  components: ReturnType<typeof useResolvedMarkdownLinks>;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rehypePlugins={rehypePlugins as any}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

/** The tooltip, positioned by CSS variables rather than inline top/left so the stylesheet keeps ownership of how it is offset from the text. */
function HoverPopover({
  at,
  statement,
  repo,
  branch,
}: {
  at: { x: number; y: number };
  statement: StatementInfo;
  repo: string;
  branch: string;
}) {
  return (
    <div
      className={styles.popover}
      style={{
        ["--popover-x" as string]: `${at.x}px`,
        ["--popover-y" as string]: `${at.y}px`,
      }}
      role="tooltip"
    >
      <StatementPopover statement={statement} repo={repo} branch={branch} />
    </div>
  );
}

/** Which statement the pointer is over, and everything needed to say something about it. The ordinal is the join: the rehype plugins stamp it into the rendered HTML, the mouse handler reads it back off the hovered element, and this lookup turns it into the statement's coverage record. */
function useHoveredStatement(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  statements: StatementInfo[],
) {
  const { hover, onMouseOver, onMouseLeave } = useStatementHover(wrapperRef);
  const { statementsByOrdinal, rehypePlugins } =
    useStatementHighlighting(statements);

  return {
    hover,
    hovered: hover ? statementsByOrdinal.get(hover.ordinal) : null,
    rehypePlugins,
    onMouseOver,
    onMouseLeave,
  };
}

export default function SpecDetails(props: SpecDetailsProps) {
  const { content, statements, repo, branch } = resolveSpecDetailsProps(props);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { hover, hovered, rehypePlugins, onMouseOver, onMouseLeave } =
    useHoveredStatement(wrapperRef, statements);

  return (
    <div>
      <div
        ref={wrapperRef}
        className={`${readme.readme} ${styles.specBody}`}
        onMouseOver={onMouseOver}
        onMouseLeave={onMouseLeave}
      >
        <SpecMarkdown
          content={content}
          rehypePlugins={rehypePlugins}
          components={useResolvedMarkdownLinks(repo, branch)}
        />
        {hover && hovered && (
          <HoverPopover
            at={hover}
            statement={hovered}
            repo={repo}
            branch={branch}
          />
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
