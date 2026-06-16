import { describe, it, expect } from 'vitest';
import { aggregateLeaves, shouldAggregate } from './graph-aggregation';

const COLLAPSIBLE = new Set(['TestChunk', 'File', 'CodeChunk'] as const);

describe('aggregateLeaves', () => {
  it('collapses a degree-1 TestChunk into a badge on its parent', () => {
    const nodes = [
      { id: 'stmt1', type: 'Statement' as const },
      { id: 'test1', type: 'TestChunk' as const },
    ];
    const links = [{ source: 'stmt1', target: 'test1', kind: 'validated_by' }];

    const result = aggregateLeaves(nodes, links, COLLAPSIBLE);

    expect(result.hidden.has('test1')).toBe(true);
    expect(result.badges).toEqual([{ parentId: 'stmt1', type: 'TestChunk', count: 1 }]);
  });

  it('keeps a TestChunk shared by two statements visible', () => {
    const nodes = [
      { id: 'stmt1', type: 'Statement' as const },
      { id: 'stmt2', type: 'Statement' as const },
      { id: 'test1', type: 'TestChunk' as const },
    ];
    const links = [
      { source: 'stmt1', target: 'test1', kind: 'validated_by' },
      { source: 'stmt2', target: 'test1', kind: 'validated_by' },
    ];

    const result = aggregateLeaves(nodes, links, COLLAPSIBLE);

    expect(result.hidden.size).toBe(0);
    expect(result.badges).toEqual([]);
  });

  it('groups multiple single-owner leaves into one badge per parent and type', () => {
    const nodes = [
      { id: 'stmt1', type: 'Statement' as const },
      { id: 'test1', type: 'TestChunk' as const },
      { id: 'test2', type: 'TestChunk' as const },
      { id: 'file1', type: 'File' as const },
    ];
    const links = [
      { source: 'stmt1', target: 'test1', kind: 'validated_by' },
      { source: 'stmt1', target: 'test2', kind: 'validated_by' },
      { source: 'stmt1', target: 'file1', kind: 'implemented_by' },
    ];

    const result = aggregateLeaves(nodes, links, COLLAPSIBLE);

    expect(result.hidden).toEqual(new Set(['test1', 'test2', 'file1']));
    expect(result.badges).toEqual([
      { parentId: 'stmt1', type: 'TestChunk', count: 2 },
      { parentId: 'stmt1', type: 'File', count: 1 },
    ]);
  });

  it('returns no badges when no collapsible leaves exist', () => {
    const nodes = [
      { id: 'feat1', type: 'Feature' as const },
      { id: 'spec1', type: 'Spec' as const },
    ];
    const links = [{ source: 'feat1', target: 'spec1', kind: 'in_feature' }];

    const result = aggregateLeaves(nodes, links, COLLAPSIBLE);

    expect(result.hidden.size).toBe(0);
    expect(result.badges).toEqual([]);
  });

  it('treats an AcceptanceCriterion parent like a Statement parent', () => {
    const nodes = [
      { id: 'ac1', type: 'AcceptanceCriterion' as const },
      { id: 'test1', type: 'TestChunk' as const },
    ];
    const links = [{ source: 'ac1', target: 'test1', kind: 'validated_by' }];

    const result = aggregateLeaves(nodes, links, COLLAPSIBLE);

    expect(result.badges).toEqual([{ parentId: 'ac1', type: 'TestChunk', count: 1 }]);
  });
});

describe('shouldAggregate', () => {
  it('aggregates when scale below threshold', () => {
    expect(shouldAggregate(0.4, 0.6)).toBe(true);
  });

  it('expands when scale at or above threshold', () => {
    expect(shouldAggregate(0.6, 0.6)).toBe(false);
    expect(shouldAggregate(1.2, 0.6)).toBe(false);
  });
});
