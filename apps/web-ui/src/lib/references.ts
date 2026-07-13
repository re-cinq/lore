// Parse references (source file paths, issue numbers, task UUIDs) out of plain
// text so the dashboard can render them as links. Behaviour mirrors
// shared/src/references.ts — duplicated here because web-ui does not depend on
// the shared package. UUIDs link to the internal /assembly-lines page; files and
// issues link to GitHub.

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
const SCAN_SRC = `(?<file>${FILE_SRC})|(?<issue>${ISSUE_SRC})|(?<uuid>${UUID_SRC})`;

function hrefFor(
  match: string,
  group: "file" | "issue" | "uuid",
  ctx: RefContext,
): string {
  if (group === "file") {
    return `https://github.com/${ctx.repo}/blob/${ctx.branch || "main"}/${match.replace(/^\.\//, "")}`;
  }
  if (group === "issue")
    return `https://github.com/${ctx.repo}/issues/${match.slice(1)}`;
  return `/assembly-lines/${match}`;
}

export function parseReferences(text: string, ctx: RefContext): Segment[] {
  const out: Segment[] = [];
  const re = new RegExp(SCAN_SRC, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const group: "file" | "issue" | "uuid" = m.groups?.file
      ? "file"
      : m.groups?.issue
        ? "issue"
        : "uuid";
    out.push({ text: m[0], href: hrefFor(m[0], group, ctx) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
