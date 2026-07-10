const ACRONYMS = new Set([
  'adr',
  'pr',
  'llm',
  'api',
  'ci',
  'cd',
  'url',
  'id',
  'ui',
  'db',
  'json',
  'yaml',
  'md',
  'pdf',
  'sql',
]);

export function formatEnumLabel(value: string): string {
  const words = value.split(/[_-]+/).filter(Boolean);
  if (words.length === 0) return value;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      return index === 0 ? word.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}
