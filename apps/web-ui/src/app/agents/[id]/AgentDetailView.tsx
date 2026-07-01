interface VersionRow {
  version: number;
  value: string;
  created_at: string;
}

interface FactRow {
  fact_text: string;
  created_at: string;
}

export interface MemoryViewRow {
  id: string;
  key: string;
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  has_facts: boolean;
  versions: VersionRow[];
  facts: FactRow[];
}

export interface AgentDetailViewProps {
  agentId: string;
  memoryCount: number;
  memories: MemoryViewRow[];
}

export default function AgentDetailView({ agentId, memoryCount, memories }: AgentDetailViewProps) {
  return (
    <div>
      <h1>Agent: {agentId.substring(0, 12)}...</h1>
      <p>{memoryCount} memories</p>
      <div className="memory-list">
        {memories.map(m => (
          <details key={m.id} className="memory-card">
            <summary>
              <strong>{m.key}</strong>
              <span className="meta">v{m.version} · {new Date(m.created_at).toLocaleString()}</span>
              {m.has_facts && <span className="badge">facts</span>}
              {m.ttl_seconds && <span className="badge">TTL: {m.ttl_seconds}s</span>}
            </summary>
            <div className="memory-detail">
              <h4>Current Value</h4>
              <pre>{m.value}</pre>
              {m.versions.length > 1 && (
                <>
                  <h4>Version History ({m.versions.length})</h4>
                  {m.versions.map(v => (
                    <div key={v.version} className="version">
                      <span>v{v.version} — {new Date(v.created_at).toLocaleString()}</span>
                      <pre>{v.value}</pre>
                    </div>
                  ))}
                </>
              )}
              {m.facts.length > 0 && (
                <>
                  <h4>Extracted Facts ({m.facts.length})</h4>
                  <ul>
                    {m.facts.map((f, i) => <li key={i}>{f.fact_text}</li>)}
                  </ul>
                </>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
