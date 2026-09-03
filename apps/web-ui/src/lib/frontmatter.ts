// Minimal YAML-lite frontmatter parser covering exactly the shapes the ADR
// corpus uses (scalars, quoted scalars, flow lists, block lists) — no yaml
// dependency. Only a block opening the document counts; a later `---` is a
// horizontal rule.

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
    const value = rawValue.trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
      continue;
    }

    const blockItems = value === "" ? collectBlockListItems(lines, i + 1) : [];

    if (value === "" && blockItems.length === 0) {
      continue;
    }

    if (value === "") {
      meta[key] = blockItems;
      i += blockItems.length;
      continue;
    }
    meta[key] = unquote(value);
  }

  return { meta, body: source.slice(match[0].length) };
}
