// Parse references (source file paths, issue numbers, task UUIDs) out of plain
// text so the dashboard can render them as links. Behaviour mirrors
// shared/src/references.ts — duplicated here because web-ui does not depend on
// the shared package; `references.parity.test.ts` holds the two in lockstep.
// Intentional delta: task UUIDs always link to the relative internal
// /assembly-runs page (shared needs an absolute `uiUrl` and omits the href
// without one), and web-ui renders segments itself so `linkifyMarkdown` has no
// mirror here.

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

// Spans to leave verbatim: inline code, existing markdown links, bare URLs.
// Link targets may contain one balanced paren pair (wiki-style urls, paths);
// the disjoint alternatives keep the pattern backtracking-safe.
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

function scanPlain(text: string, ctx: RefContext): Segment[] {
  const out: Segment[] = [];
  const re = new RegExp(SCAN_SRC, "gi");
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ text: text.slice(last, m.index) });
    }
    const group: "file" | "issue" | "uuid" = m.groups?.file
      ? "file"
      : m.groups?.issue
        ? "issue"
        : "uuid";

    out.push({ text: m[0], href: hrefFor(m[0], group, ctx) });
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
