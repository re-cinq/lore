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
    } else if (value === "") {
      const items: string[] = [];

      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[i + 1].replace(/^\s*-\s+/, "")));
        i++;
      }

      if (items.length > 0) {
        meta[key] = items;
      }
    } else {
      meta[key] = unquote(value);
    }
  }

  return { meta, body: source.slice(match[0].length) };
}
