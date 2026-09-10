"use client";

import { useState } from "react";
import type { SpecGraph } from "@/lib/spec-graph";
import SpecGraphD3 from "./SpecGraphD3";

const SEARCH_INPUT: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-surface)",
  color: "var(--text)",
  fontSize: "var(--fs-sm)",
  minWidth: 200,
};

const BTN: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: "var(--fs-sm)",
};

const TOOLBAR_ROW = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  justifyContent: "flex-end",
  flexWrap: "wrap",
} as const;

const GRAPH_COLUMN = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
} as const;

interface GraphViewProps {
  owner: string;
  repo: string;
  graph: SpecGraph;
}

/** Toolbar + graph container with search/reset; reset clears persisted layout and re-runs layout effect. */
export default function GraphView({ owner, repo, graph }: GraphViewProps) {
  const repoId = `${owner}/${repo}`;
  const { query, setQuery, resetSignal, reset } = useGraphViewState(repoId);

  return (
    <div style={GRAPH_COLUMN}>
      <GraphToolbar query={query} onQueryChange={setQuery} onReset={reset} />
      <SpecGraphD3
        graph={graph}
        repo={repoId}
        searchQuery={query}
        resetSignal={resetSignal}
      />
    </div>
  );
}

interface GraphToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onReset: () => void;
}

/** Search and reset. Reset clears the SAVED layout as well as the query — a graph someone has dragged into a shape keeps that shape across visits, so resetting the search alone would leave it looking untouched. */
function GraphToolbar({ query, onQueryChange, onReset }: GraphToolbarProps) {
  return (
    <div style={TOOLBAR_ROW}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search nodes…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          style={SEARCH_INPUT}
          aria-label="Search nodes"
        />
        <button style={BTN} onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}

/** The search query and the reset signal the layout effect watches; resetting bumps the signal AND drops the saved layout. */
function useGraphViewState(repoId: string) {
  const [query, setQuery] = useState("");
  const [resetSignal, setResetSignal] = useState(0);

  function reset() {
    clearSavedLayout(repoId);
    setQuery("");
    setResetSignal((n) => n + 1);
  }

  return { query, setQuery, resetSignal, reset };
}

/** Forgets the dragged-into-place layout for this repo. Storage being unavailable is not a failure worth surfacing — the reset signal alone still re-settles the graph, which is what the reader asked for. */
function clearSavedLayout(repoId: string): void {
  try {
    localStorage.removeItem(`lore.graph:${repoId}`);
  } catch {
    // storage unavailable — the signal bump alone still re-settles the layout
  }
}
