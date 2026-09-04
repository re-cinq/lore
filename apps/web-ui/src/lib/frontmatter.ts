// Minimal YAML-lite frontmatter parser for ADR corpus (no yaml dependency).

export interface Frontmatter {
  meta: Record<string, string | string[]>;
  body: string;
}

const LEADING_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const unquote = (value: string): string =>
  value.replace(/^["']|["']$/g, "").trim();

function collectBlockListItems(lines: string[], startIndex: number): string[] {
  const values: string[] = [];
  let cursor = startIndex;

  while (cursor < lines.length && /^\s*-\s+/.test(lines[cursor])) {
    values.push(unquote(lines[cursor].replace(/^\s*-\s+/, "")));
    cursor++;
  }

  return values;
}

function parseFlowList(value: string): string[] | null {
  if (!value.startsWith("[") || !value.endsWith("]")) {
    return null;
  }

  return value.slice(1, -1).split(",").map(unquote).filter(Boolean);
}

interface MetaLine {
  lines: string[];
  index: number;
  key: string;
  rawValue: string;
}

/** Applies one `key: value` line to `meta`; returns the line index to resume from (past any consumed block list). */
function applyMetaLine(
  meta: Record<string, string | string[]>,
  { lines, index, key, rawValue }: MetaLine,
): number {
  const value = rawValue.trim();
  const flowList = parseFlowList(value);

  if (flowList) {
    meta[key] = flowList;

    return index;
  }

  if (value !== "") {
    meta[key] = unquote(value);

    return index;
  }
  const blockItems = collectBlockListItems(lines, index + 1);

  if (blockItems.length === 0) {
    return index;
  }
  meta[key] = blockItems;

  return index + blockItems.length;
}

export function parseFrontmatter(source: string): Frontmatter {
  const match = source.match(LEADING_FRONTMATTER);

  if (!match) {
    return { meta: {}, body: source };
  }
  const meta: Record<string, string | string[]> = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const keyValue = lines[i].match(/^(\w[\w-]*)\s*:\s*(.*)$/);

    if (!keyValue) {
      continue;
    }
    const [, key, rawValue] = keyValue;

    i = applyMetaLine(meta, { lines, index: i, key, rawValue });
  }

  return { meta, body: source.slice(match[0].length) };
}
