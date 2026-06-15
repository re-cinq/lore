import { describe, it, expect } from 'vitest';
import { CONTEXT_PAGE_SIZE, contextChunkQuery } from './pagination';

describe('contextChunkQuery', () => {
  it('fetches one row past the page size from the given offset', () => {
    const { sql, params } = contextChunkQuery('team_x', 'o/r', undefined, undefined, 100);
    expect(sql).toContain('FROM team_x.chunks');
    expect(sql).toContain('LIMIT $4 OFFSET $5');
    expect(params).toEqual(['o/r', null, null, CONTEXT_PAGE_SIZE + 1, 100]);
  });

  it('passes the active type and query through as parameters', () => {
    const { params } = contextChunkQuery('team_x', 'o/r', 'doc', 'hello', 0);
    expect(params).toEqual(['o/r', 'doc', 'hello', CONTEXT_PAGE_SIZE + 1, 0]);
  });
});
