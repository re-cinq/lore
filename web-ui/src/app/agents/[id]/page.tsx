export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

interface Memory {
  id: string;
  key: string;
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  has_facts: boolean;
}

interface Version {
  version: number;
  value: string;
  created_at: string;
}

interface Fact {
  fact_text: string;
  created_at: string;
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = decodeURIComponent(id);

  const memories = await query<Memory>(`
    SELECT m.id, m.key, m.value, m.version, m.created_at, m.ttl_seconds,
           EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
    FROM memory.memories m
    WHERE m.agent_id = $1 AND m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
    ORDER BY m.created_at DESC
    LIMIT 100
  `, [agentId]);

  // Get version histories and facts for each memory
  const memoriesWithDetails = await Promise.all(memories.map(async (m) => {
    const versions = await query<Version>(`
      SELECT version, value, created_at FROM memory.memory_versions
      WHERE memory_id = $1 ORDER BY version DESC
    `, [m.id]);
    const facts = m.has_facts ? await query<Fact>(`
      SELECT fact_text, created_at FROM memory.facts WHERE memory_id = $1
    `, [m.id]) : [];
    return { ...m, versions, facts };
  }));

  return (
    <div>
      <h1>Agent: {agentId.substring(0, 12)}...</h1>
      <p>{memories.length} memories</p>
      <div className="memory-list">
        {memoriesWithDetails.map(m => (
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
