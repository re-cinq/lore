/** Removes the trailing `([validated by …](…), …; implemented by …)` coverage-link groups from spec/ADR prose before it is ranked, embedded, or handed to an agent — the links are traceability bookkeeping, and a statement with twenty of them is mostly path text that keyword-matches every question. */

const LINK = String.raw`\[[^\]]*\]\([^)\s]*\)`;

/** One coverage-link group: an opening paren, a `validated by` / `implemented by` link, any number of `, ` or `; implemented by ` continuations, a closing paren. Exported as source text so the SQL twin over `search_tsv` can carry the same grammar. */
export const SPEC_LINK_GROUP_PATTERN = String.raw`\(\s*\[(?:validated|implemented) by [^\]]*\]\([^)\s]*\)(?:\s*(?:,|;\s*implemented by)\s*${LINK})*\s*\)`;

/** The same grammar as a PostgreSQL ARE, for the `search_tsv` generated column (`regexp_replace(content, …, ' ', 'g')`). POSIX brackets instead of `\s`/`\]`, plain groups instead of `(?:`; the migration and both baseline schema scripts carry it verbatim, and a test holds them to it. */
export const SPEC_LINK_GROUP_SQL_PATTERN = String.raw`\(\s*\[(validated|implemented) by [^]]*\]\([^)[:space:]]*\)(\s*(,|;\s*implemented by)\s*\[[^]]*\]\([^)[:space:]]*\))*\s*\)`;

const GROUP_WITH_LEADING_SPACE_RE = new RegExp(
  String.raw` ?${SPEC_LINK_GROUP_PATTERN}`,
  "g",
);

export function stripCoverageLinks(text: string): string {
  return text.replace(GROUP_WITH_LEADING_SPACE_RE, "");
}
