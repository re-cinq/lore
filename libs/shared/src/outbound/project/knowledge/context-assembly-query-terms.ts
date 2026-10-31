// The names a ticket's text carries (specs/utopia-graph-mirror FR13.9): file paths, routes, symbols and member names, requirement ids and issue numbers, read without a model so a code search and a memory filter can key on them instead of on prose.

const TERM_RE =
  /(?:[\w@[\]{}.-]*\/[\w@[\]{}./-]+)|(?:[\w[\]-]+\.(?:tsx?|m?js|md|ya?ml|go|py|sql|json|sh))|(?:FR-?\d+(?:\.\d+)*)|(?:#\d+)|(?:[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)|(?:[a-z]\w*(?:\.[a-z]\w*)+)|(?:\w+_\w+)/g;

const FILE_RE = /\.(?:tsx?|m?js|md|ya?ml|go|py|sql|json|sh)$/;

/** Every term the text names, once, in the order it first appears: a path or route (anything with a slash), a file name, a requirement id, an issue number, a camelCase symbol, a dotted member or a snake_case name. */
export function queryTerms(text: string): string[] {
  const found = text.match(TERM_RE) ?? [];

  return [...new Set(found.map(trimmed).filter(isTerm))];
}

function trimmed(term: string): string {
  return term.replace(/^[.]+|[.,;:]+$/g, "");
}

function isTerm(term: string): boolean {
  return term.length > 1 && term !== "FR";
}

/** The words a code search is asked with: each file by its name alone (a folder ranks nothing) and each symbol or member; a route, requirement id or issue number names no code. Null when the ticket names none. */
export function codeQueryOf(terms: string[]): string | null {
  const words = terms.flatMap((term) => {
    if (term.startsWith("#") || /^FR-?\d/.test(term)) {
      return [];
    }

    if (term.includes("/")) {
      const file = term.slice(term.lastIndexOf("/") + 1);

      return FILE_RE.test(file) ? [file] : [];
    }

    return [term];
  });

  return words.length > 0 ? [...new Set(words)].join(" ") : null;
}

/** Whether the text names any of the terms, case aside; a path counts by its file name, so a memory that says `board.ts` meets a ticket that gives the whole path. */
export function mentionsAny(text: string, terms: string[]): boolean {
  const haystack = text.toLowerCase();

  return terms.some((term) =>
    haystack.includes(fileNameOf(term).toLowerCase()),
  );
}

function fileNameOf(term: string): string {
  return term.includes("/") && FILE_RE.test(term)
    ? term.slice(term.lastIndexOf("/") + 1)
    : term;
}
