'use client';

import { useState } from 'react';

const BTN: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-surface)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
};

export default function IngestButtons({ owner, repo }: { owner: string; repo: string }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function ingest(kinds?: string[]) {
    setBusy(true);
    setStatus('Creating ingestion task(s)…');
    try {
      const res = await fetch(`/api/repos/${owner}/${repo}/ingest-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kinds ? { kinds } : {}),
      });
      const data = (await res.json()) as { created?: Array<{ kind: string }>; skipped?: string[]; error?: string };
      if (!res.ok) {
        setStatus(`Error: ${data.error ?? res.status}`);
        return;
      }
      const made = data.created?.map((c) => c.kind).join(', ') || 'none (all already in flight)';
      const skip = data.skipped?.length ? ` · skipped in-flight: ${data.skipped.join(', ')}` : '';
      setStatus(`Created: ${made}${skip}. Track them on the Tasks / Pipeline tab.`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={{ ...BTN, fontWeight: 600 }} disabled={busy} onClick={() => ingest()}>
          Build graph (all)
        </button>
        <button style={BTN} disabled={busy} onClick={() => ingest(['specs'])}>Ingest specs</button>
        <button style={BTN} disabled={busy} onClick={() => ingest(['adrs'])}>Ingest ADRs</button>
        <button style={BTN} disabled={busy} onClick={() => ingest(['tests'])}>Ingest tests</button>
      </div>
      {status && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>{status}</p>}
    </div>
  );
}
