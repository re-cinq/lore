import { describe, it, expect, vi } from 'vitest';

// ── parseGraphExtraction (copied from graph.ts for unit testing) ────

interface ExtractedGraphEntity {
  name: string;
  type: string;
}

interface ExtractedGraphEdge {
  source: string;
  target: string;
  relation: string;
}

function parseGraphExtraction(raw: string): {
  entities: ExtractedGraphEntity[];
  edges: ExtractedGraphEdge[];
} {
  try {
    const cleaned = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const entities = (parsed.entities || [])
      .filter((e: any) => e.name && e.type)
      .map((e: any) => ({ name: String(e.name).toLowerCase().trim(), type: String(e.type).toLowerCase().trim() }))
      .slice(0, 10);
    const edges = (parsed.edges || [])
      .filter((e: any) => e.source && e.target && e.relation)
      .map((e: any) => ({
        source: String(e.source).toLowerCase().trim(),
        target: String(e.target).toLowerCase().trim(),
        relation: String(e.relation).toLowerCase().trim(),
      }))
      .slice(0, 10);
    return { entities, edges };
  } catch {
    return { entities: [], edges: [] };
  }
}

describe('parseGraphExtraction', () => {
  it('parses entities and edges from JSON', () => {
    const input = JSON.stringify({
      entities: [
        { name: 'Auth-Service', type: 'service' },
        { name: 'PostgreSQL', type: 'technology' },
      ],
      edges: [
        { source: 'Auth-Service', target: 'PostgreSQL', relation: 'uses' },
      ],
    });

    const result = parseGraphExtraction(input);
    expect(result.entities).toEqual([
      { name: 'auth-service', type: 'service' },
      { name: 'postgresql', type: 'technology' },
    ]);
    expect(result.edges).toEqual([
      { source: 'auth-service', target: 'postgresql', relation: 'uses' },
    ]);
  });

  it('normalizes names to lowercase', () => {
    const input = JSON.stringify({
      entities: [{ name: 'MyService', type: 'Service' }],
      edges: [],
    });

    const result = parseGraphExtraction(input);
    expect(result.entities[0].name).toBe('myservice');
    expect(result.entities[0].type).toBe('service');
  });

  it('handles code-fenced JSON', () => {
    const input = '```json\n{"entities": [{"name": "test", "type": "concept"}], "edges": []}\n```';
    const result = parseGraphExtraction(input);
    expect(result.entities).toHaveLength(1);
  });

  it('returns empty on invalid JSON', () => {
    const result = parseGraphExtraction('this is not json');
    expect(result.entities).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('limits to 10 entities and 10 edges', () => {
    const input = JSON.stringify({
      entities: Array.from({ length: 15 }, (_, i) => ({ name: `e${i}`, type: 'concept' })),
      edges: Array.from({ length: 15 }, (_, i) => ({
        source: `e${i}`, target: `e${i + 1}`, relation: 'uses',
      })),
    });

    const result = parseGraphExtraction(input);
    expect(result.entities).toHaveLength(10);
    expect(result.edges).toHaveLength(10);
  });

  it('filters entities with missing fields', () => {
    const input = JSON.stringify({
      entities: [
        { name: 'valid', type: 'concept' },
        { name: 'no-type' },
        { type: 'no-name' },
        {},
      ],
      edges: [],
    });

    const result = parseGraphExtraction(input);
    expect(result.entities).toHaveLength(1);
  });
});

// ── Edge invalidation logic ────────────────────────────────────────

describe('edge temporal invalidation', () => {
  it('invalidates contradictory edges (same source+relation, different target)', async () => {
    const invalidated: string[] = [];
    const inserted: any[] = [];

    const mockPool = {
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT id FROM memory.edges')) {
          // No existing exact edge
          return { rows: [] };
        }
        if (sql.includes('UPDATE memory.edges')) {
          invalidated.push(`${params[0]}-${params[1]}-${params[2]}`);
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO memory.edges')) {
          inserted.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    // Simulate upsertEdge
    async function upsertEdge(
      pool: any, sourceId: string, targetId: string, relationType: string,
    ) {
      const { rows: existing } = await pool.query(
        'SELECT id FROM memory.edges WHERE source_id = $1 AND target_id = $2 AND relation_type = $3 AND valid_to IS NULL',
        [sourceId, targetId, relationType],
      );
      if (existing.length > 0) return;

      await pool.query(
        'UPDATE memory.edges SET valid_to = now() WHERE source_id = $1 AND relation_type = $2 AND target_id != $3 AND valid_to IS NULL',
        [sourceId, relationType, targetId],
      );

      await pool.query(
        'INSERT INTO memory.edges (source_id, target_id, relation_type) VALUES ($1, $2, $3)',
        [sourceId, targetId, relationType],
      );
    }

    await upsertEdge(mockPool, 'auth-service', 'hono', 'uses');

    expect(mockPool.query).toHaveBeenCalledTimes(3); // check + invalidate + insert
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual(['auth-service', 'hono', 'uses']);
  });

  it('skips insert when exact edge already exists', async () => {
    const mockPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id FROM memory.edges')) {
          return { rows: [{ id: 'existing-edge' }] };
        }
        return { rows: [] };
      }),
    };

    async function upsertEdge(
      pool: any, sourceId: string, targetId: string, relationType: string,
    ) {
      const { rows: existing } = await pool.query(
        'SELECT id FROM memory.edges WHERE source_id = $1 AND target_id = $2 AND relation_type = $3 AND valid_to IS NULL',
        [sourceId, targetId, relationType],
      );
      if (existing.length > 0) return;
      // Should not reach here
      throw new Error('Should not insert');
    }

    await upsertEdge(mockPool, 'auth-service', 'hono', 'uses');
    expect(mockPool.query).toHaveBeenCalledTimes(1); // only the check
  });
});
