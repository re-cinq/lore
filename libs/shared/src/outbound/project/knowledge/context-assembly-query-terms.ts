// The names a ticket's text carries (specs/utopia-graph-mirror FR13.9): file paths, routes, symbols and member names, requirement ids and issue numbers, read without a model so a code search and a memory filter can key on them instead of on prose.

const TERM_RE =
  /(?:https?:\/\/\S+)|(?:[\w@[\]{}.-]*\/[\w@[\]{}./-]+)|(?:[\w[\]-]+\.(?:tsx?|m?js|md|ya?ml|go|py|sql|json|sh))|(?:FR-?\d+(?:\.\d+)*)|(?:#\d+)|(?:[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)|(?:[a-z]\w*(?:\.[a-z]\w*)+)|(?:\w+_\w+)/g;

const FILE_RE = /\.(?:tsx?|m?js|md|ya?ml|go|py|sql|json|sh)$/;

/** Files every repository has, which name no ticket: a memory or a code item that says `spec.md` says nothing about which. */
const GENERIC_FILES = new Set([
  "spec.md",
  "plan.md",
  "tasks.md",
  "readme.md",
  "claude.md",
  "agents.md",
  "changelog.md",
  "package.json",
  "index.ts",
]);

/** Every term the text names, once, in the order it first appears: a path or route (anything with a slash), a file name, a requirement id, an issue number, a camelCase symbol, a dotted member or a snake_case name; a URL names nothing, and a generic file name such as `README.md` is left out. */
export function queryTerms(text: string): string[] {
  const found = text.match(TERM_RE) ?? [];

  return [...new Set(found.map(trimmed).filter(isTerm))];
}

function trimmed(term: string): string {
  return term.replace(/^[.[(]+|[.,;:)\]]+$/g, "");
}

function isTerm(term: string): boolean {
  return (
    term.length > 1 &&
    term !== "FR" &&
    !term.startsWith("http") &&
    !GENERIC_FILES.has(term.toLowerCase())
  );
}

/** The words a code search is asked with: each file by its name alone and by its stem (a folder ranks nothing, and the stem meets the symbol a component exports under its own name), and each symbol or member; a route, requirement id or issue number names no code. Null when the ticket names none. */
export function codeQueryOf(terms: string[]): string | null {
  const words = terms.flatMap(codeWords);

  return words.length > 0 ? [...new Set(words)].join(" ") : null;
}

function codeWords(term: string): string[] {
  if (isRequirement(term) || term.startsWith("#")) {
    return [];
  }
  const file = fileNameOf(term);

  if (file === null) {
    return term.includes("/") ? [] : [term];
  }

  return [file, file.slice(0, file.indexOf("."))];
}

/** How many places in the repository the ticket names: the folder of each file path, the folder a folder path is, and each bare file name; a symbol, a route, a requirement id or an issue number names no place. */
export function areaCount(terms: string[]): number {
  return new Set(terms.map(areaOf).filter((area) => area !== null)).size;
}

function areaOf(term: string): string | null {
  if (term.startsWith("/") || term.startsWith("#")) {
    return null;
  }
  const slash = term.lastIndexOf("/");
  const last = term.slice(slash + 1);

  if (!FILE_RE.test(last)) {
    return slash > 0 ? term : null;
  }

  return slash > 0 ? term.slice(0, slash) : last;
}

/** The file names the terms carry, once each: `board.ts` for `apps/web-ui/.../board.ts` and for `board.ts`. */
export function fileNamesOf(terms: string[]): string[] {
  return [...new Set(terms.map(fileNameOf).filter((file) => file !== null))];
}

/** Whether the text names any of the ticket's files or symbols, case aside; a path counts by its file name, so a memory that says `board.ts` meets a ticket that gives the whole path, and a requirement id counts for nothing, since every DoD run cites one. */
export function mentionsAny(text: string, terms: string[]): boolean {
  const haystack = text.toLowerCase();

  return terms.some(
    (term) =>
      !isRequirement(term) &&
      haystack.includes((fileNameOf(term) ?? term).toLowerCase()),
  );
}

function isRequirement(term: string): boolean {
  return /^FR-?\d/.test(term);
}

/** The file name of a file term or of a path that ends in one; null for a symbol, a route or a folder. */
function fileNameOf(term: string): string | null {
  const file = term.slice(term.lastIndexOf("/") + 1);

  return FILE_RE.test(file) && !GENERIC_FILES.has(file.toLowerCase())
    ? file
    : null;
}
