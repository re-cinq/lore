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

type Memory = AgentDetailViewProps["memories"][number];

/** What this memory used to say. Hidden when there is only the current version — a "Version History (1)" heading over the value already shown above it is noise. */
function VersionHistory({ versions }: { versions: Memory["versions"] }) {
  if (versions.length <= 1) {
    return null;
  }

  return (
    <>
      <h4>Version History ({versions.length})</h4>
      {versions.map((v) => (
        <div key={v.version} className="version">
          <span>
            v{v.version} — {new Date(v.created_at).toLocaleString()}
          </span>
          <pre>{v.value}</pre>
        </div>
      ))}
    </>
  );
}

/** The facts extracted from this memory, if any were. Keyed by index because a fact carries no id of its own here. */
function ExtractedFacts({ facts }: { facts: Memory["facts"] }) {
  if (facts.length === 0) {
    return null;
  }

  return (
    <>
      <h4>Extracted Facts ({facts.length})</h4>
      <ul>
        {facts.map((f, i) => (
          <li key={i}>{f.fact_text}</li>
        ))}
      </ul>
    </>
  );
}

/** One memory, collapsed. Its version history and extracted facts appear only when there are any — a heading over an empty list reads as data that failed to load. */
function MemoryCard({
  memory: m,
}: {
  memory: AgentDetailViewProps["memories"][number];
}) {
  return (
    <details key={m.id} className="memory-card">
      <summary>
        <strong>{m.key}</strong>
        <span className="meta">
          v{m.version} · {new Date(m.created_at).toLocaleString()}
        </span>
        {m.has_facts && <span className="badge">facts</span>}
        {m.ttl_seconds && <span className="badge">TTL: {m.ttl_seconds}s</span>}
      </summary>
      <div className="memory-detail">
        <h4>Current Value</h4>
        <pre>{m.value}</pre>
        <VersionHistory versions={m.versions} />
        <ExtractedFacts facts={m.facts} />
      </div>
    </details>
  );
}

export default function AgentDetailView({
  agentId,
  memoryCount,
  memories,
}: AgentDetailViewProps) {
  return (
    <div>
      <h1>Agent: {agentId.substring(0, 12)}...</h1>
      <p>{memoryCount} memories</p>
      <div className="memory-list">
        {memories.map((m) => (
          <MemoryCard key={m.id} memory={m} />
        ))}
      </div>
    </div>
  );
}
