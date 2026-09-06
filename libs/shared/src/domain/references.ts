/** Convert file paths, issues, task UUIDs into links; protect existing code/links/URLs. */
export interface RefContext {
  /** "owner/name" */
  repo: string;
  /** branch for file blob links; defaults to "main" */
  branch?: string;
  /** web-ui base url; when absent, task UUIDs are left as plain text */
  uiUrl?: string;
}

export interface Segment {
  text: string;
  href?: string;
}

const FILE_SRC =
  "(?:\\.\\/)?(?:[\\w.-]+\\/)*[\\w.-]+\\.(?:tsx?|jsx?|mjs|cjs|md|json|ya?ml|sql|sh|py|go|rs|tf|s?css|html?|toml|txt|env)";
const ISSUE_SRC = "#(\\d+)";
const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// Protect inline code, links, URLs; balanced parens for wiki-style URLs.
const PROTECT_SRC =
  "`[^`]+`|\\[[^\\]]*\\]\\((?:[^()]|\\([^()]*\\))*\\)|https?:\\/\\/[^\\s)]+";

const SCAN_SRC = `(?<file>${FILE_SRC})|(?<issue>${ISSUE_SRC})|(?<uuid>${UUID_SRC})`;

function hrefFor(
  match: string,
  group: "file" | "issue" | "uuid",
  ctx: RefContext,
): string | undefined {
  if (group === "file") {
    const path = match.replace(/^\.\//, "");

    return `https://github.com/${ctx.repo}/blob/${ctx.branch || "main"}/${path}`;
  }

  if (group === "issue") {
    return `https://github.com/${ctx.repo}/issues/${match.slice(1)}`;
  }

  return ctx.uiUrl
    ? `${ctx.uiUrl.replace(/\/$/, "")}/assembly-runs/${match}`
    : undefined;
}

function scanMatchGroup(
  groups: RegExpExecArray["groups"],
): "file" | "issue" | "uuid" {
  if (groups?.file) {
    return "file";
  }

  if (groups?.issue) {
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
    const group = scanMatchGroup(m.groups);
    const href = hrefFor(m[0], group, ctx);

    out.push(href ? { text: m[0], href } : { text: m[0] });
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

export function linkifyMarkdown(text: string, ctx: RefContext): string {
  return parseReferences(text, ctx)
    .map((s) => (s.href ? `[${s.text}](${s.href})` : s.text))
    .join("");
}
