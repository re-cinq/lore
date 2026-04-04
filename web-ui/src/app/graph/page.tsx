export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

interface Entity {
  id: string;
  name: string;
  entity_type: string;
  repo: string | null;
  edge_count: number;
  updated_at: string;
}

interface Edge {
  source_name: string;
  source_type: string;
  relation_type: string;
  target_name: string;
  target_type: string;
  valid_from: string;
  valid_to: string | null;
  source_label: string;
}

interface Stats {
  entity_count: number;
  active_edge_count: number;
  invalidated_edge_count: number;
}

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ entity?: string; type?: string; show_invalid?: string }> }) {
  const { entity, type, show_invalid } = await searchParams;
  const showInvalid = show_invalid === '1';

  const [stats] = await query<Stats>(`
    SELECT
      (SELECT count(*)::int FROM memory.entities) as entity_count,
      (SELECT count(*)::int FROM memory.edges WHERE valid_to IS NULL) as active_edge_count,
      (SELECT count(*)::int FROM memory.edges WHERE valid_to IS NOT NULL) as invalidated_edge_count
  `);

  const entityTypes = await query<{ entity_type: string; cnt: number }>(`
    SELECT entity_type, count(*)::int as cnt
    FROM memory.entities
    GROUP BY entity_type
    ORDER BY cnt DESC
  `);

  // If an entity is selected, show its edges
  let edges: Edge[] = [];
  if (entity) {
    const validFilter = showInvalid ? '' : 'AND e.valid_to IS NULL';
    edges = await query<Edge>(`
      SELECT s.name as source_name, s.entity_type as source_type,
             e.relation_type, t.name as target_name, t.entity_type as target_type,
             e.valid_from, e.valid_to,
             CASE WHEN ep.id IS NOT NULL THEN 'episode' ELSE 'memory' END as source_label
      FROM memory.edges e
      JOIN memory.entities s ON s.id = e.source_id
      JOIN memory.entities t ON t.id = e.target_id
      LEFT JOIN memory.episodes ep ON ep.id = e.source_episode_id
      WHERE (LOWER(s.name) = LOWER($1) OR LOWER(t.name) = LOWER($1))
        ${validFilter}
      ORDER BY e.valid_from DESC
      LIMIT 50
    `, [entity]);
  }

  // List entities (filtered by type if specified)
  const entityConditions: string[] = [];
  const entityParams: any[] = [];
  let pi = 1;
  if (type) {
    entityConditions.push(`en.entity_type = $${pi}`);
    entityParams.push(type);
    pi++;
  }
  const entityWhere = entityConditions.length > 0 ? `WHERE ${entityConditions.join(' AND ')}` : '';

  const entities = await query<Entity>(`
    SELECT en.id, en.name, en.entity_type, en.repo, en.updated_at,
           (SELECT count(*)::int FROM memory.edges e
            WHERE (e.source_id = en.id OR e.target_id = en.id) AND e.valid_to IS NULL) as edge_count
    FROM memory.entities en
    ${entityWhere}
    ORDER BY en.updated_at DESC
    LIMIT 50
  `, entityParams);

  return (
    <div>
      <h1>Knowledge Graph</h1>
      <p className="meta" style={{ marginBottom: 12 }}>
        Live knowledge graph built from episodes and memories. Entities and relationships are extracted automatically.
      </p>

      <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div className="stat-card">
          <div className="stat-value">{stats.entity_count}</div>
          <div className="stat-label">Entities</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.active_edge_count}</div>
          <div className="stat-label">Active edges</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.invalidated_edge_count}</div>
          <div className="stat-label">Invalidated edges</div>
        </div>
      </div>

      {entityTypes.length > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <a href="/graph" className={!type ? 'op-badge op-search' : 'op-badge'}>all</a>
          {entityTypes.map(t => (
            <a key={t.entity_type} href={`/graph?type=${t.entity_type}`}
               className={type === t.entity_type ? 'op-badge op-search' : 'op-badge'}>
              {t.entity_type} ({t.cnt})
            </a>
          ))}
        </div>
      )}

      <h2>Entities</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Repo</th><th>Edges</th><th>Updated</th><th></th></tr>
        </thead>
        <tbody>
          {entities.map(e => (
            <tr key={e.id} style={entity?.toLowerCase() === e.name.toLowerCase() ? { background: 'var(--border)' } : {}}>
              <td><strong>{e.name}</strong></td>
              <td><span className="op-badge">{e.entity_type}</span></td>
              <td>{e.repo || '\u2014'}</td>
              <td>{e.edge_count}</td>
              <td>{new Date(e.updated_at).toLocaleDateString()}</td>
              <td><a href={`/graph?entity=${encodeURIComponent(e.name)}${type ? `&type=${type}` : ''}`}>explore</a></td>
            </tr>
          ))}
          {entities.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#666', padding: 24 }}>
              No entities yet. Write episodes to populate the graph.
            </td></tr>
          )}
        </tbody>
      </table>

      {entity && (
        <>
          <h2>Relationships for &quot;{entity}&quot;</h2>
          <div style={{ marginBottom: '0.5rem' }}>
            <a href={`/graph?entity=${encodeURIComponent(entity)}${showInvalid ? '' : '&show_invalid=1'}`} style={{ fontSize: '13px' }}>
              {showInvalid ? 'Hide invalidated' : 'Show invalidated edges'}
            </a>
          </div>
          <table>
            <thead>
              <tr><th>Source</th><th>Relation</th><th>Target</th><th>Since</th><th>Status</th><th>From</th></tr>
            </thead>
            <tbody>
              {edges.map((e, i) => (
                <tr key={i} style={e.valid_to ? { opacity: 0.5 } : {}}>
                  <td><strong>{e.source_name}</strong> <span className="meta">({e.source_type})</span></td>
                  <td><span className="op-badge">{e.relation_type}</span></td>
                  <td><strong>{e.target_name}</strong> <span className="meta">({e.target_type})</span></td>
                  <td>{new Date(e.valid_from).toLocaleDateString()}</td>
                  <td>{e.valid_to
                    ? <span className="op-badge op-delete">invalidated {new Date(e.valid_to).toLocaleDateString()}</span>
                    : <span className="op-badge op-write">active</span>
                  }</td>
                  <td><span className="meta">{e.source_label}</span></td>
                </tr>
              ))}
              {edges.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#666', padding: 24 }}>No relationships found for this entity.</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
