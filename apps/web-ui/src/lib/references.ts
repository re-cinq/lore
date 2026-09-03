// Parse refs (file paths, issues, UUIDs) from plain text; mirrors shared/src/references.ts (web-ui duplication); task UUIDs link to /assembly-runs.

export interface RefContext {
  repo: string;
  branch?: string;
}

export interface Segment {
  text: string;
  href?: string;
}

const FILE_SRC =
  "(?:\\.\\/)?(?:[\\w.-]+\\/)*[\\w.-]+\\.(?:tsx?|jsx?|mjs|cjs|md|json|ya?ml|sql|sh|py|go|rs|tf|s?css|html?|toml|txt|env)";
const ISSUE_SRC = "#(\\d+)";
const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// Protect from linkification: inline code, markdown links, bare URLs; link targets support one balanced paren pair.
const PROTECT_SRC =
  "`[^`]+`|\\[[^\\]]*\\]\\((?:[^()]|\\([^()]*\\))*\\)|https?:\\/\\/[^\\s)]+";

const SCAN_SRC = `(?<file>${FILE_SRC})|(?<issue>${ISSUE_SRC})|(?<uuid>${UUID_SRC})`;

function hrefFor(
  match: string,
  group: "file" | "issue" | "uuid",
  ctx: RefContext,
): string {
  if (group === "file") {
    const path = match.replace(/^\.\//, "");

    return `https://github.com/${ctx.repo}/blob/${ctx.branch || "main"}/${path}`;
  }

  if (group === "issue") {
    return `https://github.com/${ctx.repo}/issues/${match.slice(1)}`;
  }

  return `/assembly-runs/${match}`;
}

function matchGroup(m: RegExpExecArray): "file" | "issue" | "uuid" {
  if (m.groups?.file) {
    return "file";
  }

  if (m.groups?.issue) {
    return "issue";
  }

  return "uuid";
}

function scanPlain(text: string, ctx: RefContext): Segment[] {
  const out: Segment[] = [];
  const re = new RegExp(SCAN_SRC, "gi");
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ text: text.slice(last, m.index) });
    }
    out.push({ text: m[0], href: hrefFor(m[0], matchGroup(m), ctx) });
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    out.push({ text: text.slice(last) });
  }

  return out;
}

export function parseReferences(text: string, ctx: RefContext): Segment[] {
  const out: Segment[] = [];
  const re = new RegExp(PROTECT_SRC, "g");
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(...scanPlain(text.slice(last, m.index), ctx));
    }
    out.push({ text: m[0] });
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    out.push(...scanPlain(text.slice(last), ctx));
  }

  return out;
}
