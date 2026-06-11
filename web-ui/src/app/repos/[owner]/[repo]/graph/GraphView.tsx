'use client';

import { useState } from 'react';
import type { SpecGraph } from '@/lib/spec-graph';
import SpecGraphD3 from './SpecGraphD3';
import IngestButtons, { BTN } from './IngestButtons';

const SEARCH_INPUT: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-surface)',
  color: 'var(--text)',
  fontSize: 13,
  minWidth: 200,
};

/**
 * Toolbar + graph container. Holds the search query and a reset signal, wiring
 * the ingest buttons, a live node-search input, and a Reset button into one row
 * above the D3 graph. Reset clears the persisted layout for this repo and bumps
 * `resetSignal`, which re-runs the graph's layout effect from scratch.
 */
export default function GraphView({ owner, repo, data }: { owner: string; repo: string; data: SpecGraph }) {
  const [query, setQuery] = useState('');
  const [resetSignal, setResetSignal] = useState(0);
  const repoId = `${owner}/${repo}`;

  function reset() {
    try {
      localStorage.removeItem(`lore.graph:${repoId}`);
    } catch {
      // storage unavailable — the signal bump alone still re-settles the layout
    }
    setQuery('');
    setResetSignal((n) => n + 1);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <IngestButtons owner={owner} repo={repo} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search nodes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={SEARCH_INPUT}
            aria-label="Search nodes"
          />
          <button style={BTN} onClick={reset}>Reset</button>
        </div>
      </div>
      <SpecGraphD3 data={data} repo={repoId} searchQuery={query} resetSignal={resetSignal} />
    </div>
  );
}
