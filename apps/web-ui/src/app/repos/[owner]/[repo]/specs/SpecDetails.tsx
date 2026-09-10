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

/** The markdown and the repo revision its relative links resolve against, carried together because every renderer below needs all three. */
interface SpecSource {
  content: string;
  repo: string;
  branch: string;
}

export default function SpecDetails(props: SpecDetailsProps) {
  const { content, statements, repo, branch } = resolveSpecDetailsProps(props);

  return (
    <div>
      <SpecCanvas spec={{ content, repo, branch }} statements={statements} />
    </div>
  );
}

function resolveSpecDetailsProps(props: SpecDetailsProps) {
  return {
    content: props.content,
    statements: props.statements ?? [],
    repo: props.repo,
    branch: props.branch ?? "main",
  };
}

interface SpecCanvasProps {
  spec: SpecSource;
  statements: StatementInfo[];
}

/** The rendered spec plus the pointer tracking over it. The wrapper is the measuring frame the tooltip is positioned against, which is why the ref, the handlers and the popover live in one component. */
function SpecCanvas({ spec, statements }: SpecCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { hover, hovered, rehypePlugins, handlers } = useHoveredStatement(
    wrapperRef,
    statements,
  );

  return (
    <div
      ref={wrapperRef}
      className={`${readme.readme} ${styles.specBody}`}
      {...handlers}
    >
      <SpecMarkdown spec={spec} rehypePlugins={rehypePlugins} />
      {hover && hovered && (
        <HoverPopover at={hover} statement={hovered} spec={spec} />
      )}
    </div>
  );
}

interface SpecMarkdownProps {
  spec: SpecSource;
  rehypePlugins: ReturnType<typeof useStatementHighlighting>["rehypePlugins"];
}

/** The spec itself, with the statement-highlighting plugins applied. Those plugins are what put the hover targets in the rendered HTML, so the popover has something to attach to. */
function SpecMarkdown({ spec, rehypePlugins }: SpecMarkdownProps) {
  const { content, repo, branch } = spec;
  const components = useResolvedMarkdownLinks(repo, branch);

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

interface HoverPopoverProps {
  at: { x: number; y: number };
  statement: StatementInfo;
  spec: SpecSource;
}

/** The tooltip, positioned by CSS variables rather than inline top/left so the stylesheet keeps ownership of how it is offset from the text. */
function HoverPopover({ at, statement, spec }: HoverPopoverProps) {
  return (
    <div
      className={styles.popover}
      style={{
        ["--popover-x" as string]: `${at.x}px`,
        ["--popover-y" as string]: `${at.y}px`,
      }}
      role="tooltip"
    >
      <StatementPopover
        statement={statement}
        repo={spec.repo}
        branch={spec.branch}
      />
    </div>
  );
}

/** Which statement the pointer is over, and everything needed to say something about it. */
function useHoveredStatement(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  statements: StatementInfo[],
) {
  const { hover, handlers } = useStatementHover(wrapperRef);
  const { statementsByOrdinal, rehypePlugins } =
    useStatementHighlighting(statements);

  return {
    hover,
    hovered: hover ? statementsByOrdinal.get(hover.ordinal) : null,
    rehypePlugins,
    handlers,
  };
}

interface HoverPoint {
  ordinal: number;
  x: number;
  y: number;
}

/** Which highlighted statement the pointer is over, and where to put its tooltip — measured against the wrapper, so the popover sits with the text rather than the viewport. */
function useStatementHover(wrapperRef: React.RefObject<HTMLDivElement | null>) {
  const [hover, setHover] = useState<HoverPoint | null>(null);

  function onMouseOver(event: React.MouseEvent<HTMLDivElement>) {
    const target = hoverTarget(event);
    const next = target ? hoverPoint(target, wrapperRef) : null;

    if (!target || next) {
      setHover(next);
    }
  }

  function onMouseLeave() {
    setHover(null);
  }

  return { hover, handlers: { onMouseOver, onMouseLeave } };
}

/** The highlighted statement the pointer is inside, found by walking up from whatever inline element the event landed on. */
function hoverTarget(event: React.MouseEvent<HTMLDivElement>) {
  return (event.target as HTMLElement).closest<HTMLElement>(
    "mark[data-ordinal]",
  );
}

/** Where to anchor the tooltip for `target`, or null when its ordinal is unusable — an unreadable ordinal leaves the current hover alone rather than clearing it. */
function hoverPoint(
  target: HTMLElement,
  wrapperRef: React.RefObject<HTMLDivElement | null>,
): HoverPoint | null {
  const ordinal = Number(target.dataset.ordinal);

  if (!Number.isFinite(ordinal)) {
    return null;
  }
  const { left, top } = tooltipPosition(target, wrapperRef);

  return { ordinal, x: left, y: top };
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

/** The markdown pipeline for a spec: an ordinal lookup for the hover, and the rehype chain that highlights each statement by its coverage state. Sanitisation sits BETWEEN raw HTML and the highlighter — raw first so a spec's own markup renders, sanitize next so it cannot inject, and the highlighter last because it only adds attributes to nodes that already survived. */
function useStatementHighlighting(statements: StatementInfo[]) {
  const statementsByOrdinal = useStatementsByOrdinal(statements);
  const plugin = useMemo(() => {
    if (statements.length === 0) {
      return null;
    }

    return buildHighlighter(highlightInput(statements));
  }, [statements]);

  const sanitize = [rehypeSanitize, markdownSanitizeSchema] as const;
  const rehypePlugins = plugin
    ? [rehypeRaw, sanitize, plugin]
    : [rehypeRaw, sanitize];

  return { statementsByOrdinal, rehypePlugins };
}

/** Ordinal → statement, the join the hover reads back: the rehype plugins stamp the ordinal into the rendered HTML, and this turns it into the statement's coverage record. */
function useStatementsByOrdinal(statements: StatementInfo[]) {
  return useMemo(() => {
    const byOrdinal = new Map<number, StatementInfo>();

    for (const statement of statements) {
      byOrdinal.set(statement.ordinal, statement);
    }

    return byOrdinal;
  }, [statements]);
}

/** Only the facets the highlighter matches on — the rest of a statement is irrelevant to where the `<mark>` goes. */
function highlightInput(statements: StatementInfo[]) {
  return statements.map((statement) => ({
    ordinal: statement.ordinal,
    text: statement.text,
    state: statement.state,
    drifted: statement.drifted,
  }));
}
