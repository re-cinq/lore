import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { SpecGraphNode } from "@/lib/spec-graph";
import TestPreview from "./TestPreview";
import { colorOf } from "./spec-graph-visual";
import { nodeLinks } from "./spec-graph-node-links";

/** Presentational overlays drawn on top of the canvas/SVG graph: hover tooltip, crossings label, and the selected-node detail card. */

// Memoized: re-parse markdown only on text change, not on every cursor move.
export const HoverMarkdown = memo(function HoverMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="md-popover">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export function CrossingsLabel({ crossings }: { crossings: number }) {
  return (
    <span title="straight-segment edge crossings at the settled layout (lower is clearer)">
      · {crossings < 0 ? "crossings: n/a" : `${crossings} crossings`}
    </span>
  );
}

export function HoverTooltip({
  hover,
}: {
  hover: { text: string; x: number; y: number };
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: Math.min(hover.x + 14, 9999),
        top: hover.y + 14,
        maxWidth: 320,
        pointerEvents: "none",
        padding: "6px 9px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        color: "var(--text)",
        boxShadow: "var(--shadow-lg)",
        fontSize: "var(--fs-xs)",
        lineHeight: 1.4,
        maxHeight: 240,
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      <HoverMarkdown text={hover.text} />
    </div>
  );
}

function SelectedNodeHeader({
  selected,
  onClose,
}: {
  selected: SpecGraphNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: colorOf(selected.type),
          display: "inline-block",
        }}
      />
      <strong>{selected.type}</strong>
      {selected.type === "Spec" && (
        <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>
          · double-click to expand
        </span>
      )}
      <button
        onClick={onClose}
        style={{
          marginLeft: "auto",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: "var(--fs-base)",
          lineHeight: 1,
        }}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}

function SelectedNodePathLine({ selected }: { selected: SpecGraphNode }) {
  if (!selected.path) {
    return null;
  }

  return (
    <div
      style={{
        color: "var(--text-muted)",
        fontFamily: "monospace",
        fontSize: "var(--fs-xs)",
        marginBottom: 8,
        wordBreak: "break-all",
      }}
    >
      {selected.path}
      {selected.line ? `:${selected.line}` : ""}
    </div>
  );
}

function SelectedNodeTestPreview({
  selected,
  repo,
}: {
  selected: SpecGraphNode;
  repo: string;
}) {
  if (selected.type !== "TestChunk" || !selected.path || !selected.line) {
    return null;
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <TestPreview
        repo={repo}
        path={selected.path}
        start={selected.line}
        end={selected.endLine}
      />
    </div>
  );
}

export function SelectedNodeCard({
  selected,
  repo,
  onClose,
}: {
  selected: SpecGraphNode;
  repo: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, 28px)",
        maxWidth: 420,
        maxHeight: 320,
        overflow: "auto",
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        color: "var(--text)",
        boxShadow: "var(--shadow-lg)",
        fontSize: "var(--fs-sm)",
      }}
    >
      <SelectedNodeHeader selected={selected} onClose={onClose} />
      {selected.label && (
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.label}</div>
      )}
      {selected.detail && (
        <div
          className="md-popover"
          style={{ marginBottom: 8, lineHeight: 1.5 }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {selected.detail}
          </ReactMarkdown>
        </div>
      )}
      <SelectedNodePathLine selected={selected} />
      <SelectedNodeTestPreview selected={selected} repo={repo} />
      <div style={{ display: "flex", gap: 12 }}>
        {nodeLinks(selected, repo).map((l) => (
          <a
            key={l.href}
            href={l.href}
            target={l.external ? "_blank" : undefined}
            rel={l.external ? "noreferrer" : undefined}
            style={{ color: "var(--accent)" }}
          >
            {l.label} →
          </a>
        ))}
      </div>
    </div>
  );
}
