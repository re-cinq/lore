import { describe, it, expect } from 'vitest';
import { parseReferences } from './references';

const ctx = { repo: 're-cinq/lore', branch: 'main' };
const uuid = 'fb964a3c-2c4c-4de6-b76c-cebe715b51a9';

describe('parseReferences', () => {
  it('links a file path to the GitHub blob url', () => {
    expect(parseReferences('edit src/a.ts', ctx)).toEqual([
      { text: 'edit ' },
      { text: 'src/a.ts', href: 'https://github.com/re-cinq/lore/blob/main/src/a.ts' },
    ]);
  });

  it('links an issue reference to the GitHub issues url', () => {
    expect(parseReferences('see #424', ctx)).toEqual([
      { text: 'see ' },
      { text: '#424', href: 'https://github.com/re-cinq/lore/issues/424' },
    ]);
  });

  it('links a task uuid to the internal pipeline page', () => {
    expect(parseReferences(`task ${uuid}`, ctx)).toEqual([
      { text: 'task ' },
      { text: uuid, href: `/pipeline/${uuid}` },
    ]);
  });

  it('defaults the branch to main', () => {
    expect(parseReferences('x/y.go', { repo: 're-cinq/lore' })).toEqual([
      { text: 'x/y.go', href: 'https://github.com/re-cinq/lore/blob/main/x/y.go' },
    ]);
  });

  it('returns a single text segment for plain prose', () => {
    expect(parseReferences('nothing here', ctx)).toEqual([{ text: 'nothing here' }]);
  });

  it('does not treat a version number as a file', () => {
    expect(parseReferences('v1.2.3', ctx)).toEqual([{ text: 'v1.2.3' }]);
  });
});
