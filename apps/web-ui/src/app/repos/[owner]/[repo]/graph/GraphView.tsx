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

/** Toolbar + graph container with search/reset; reset clears persisted layout and re-runs layout effect. */
export default function GraphView({
  owner,
  repo,
  graph,
}: {
  owner: string;
  repo: string;
  graph: SpecGraph;
}) {
  const [query, setQuery] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const repoId = `${owner}/${repo}`;

  function reset() {
    try {
      localStorage.removeItem(`lore.graph:${repoId}`);
    } catch {
      // storage unavailable — the signal bump alone still re-settles the layout
    }
    setQuery("");
    setResetSignal((n) => n + 1);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search nodes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={SEARCH_INPUT}
            aria-label="Search nodes"
          />
          <button style={BTN} onClick={reset}>
            Reset
          </button>
        </div>
      </div>
      <SpecGraphD3
        graph={graph}
        repo={repoId}
        searchQuery={query}
        resetSignal={resetSignal}
      />
    </div>
  );
}
