/** Sentence splitting for spec segmentation — abbreviation/initial aware, skips trailing markdown link parentheticals. */

const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "Mr",
  "Mrs",
  "Ms",
  "Dr",
  "Sr",
  "Jr",
  "St",
  "Prof",
  "Inc",
  "Co",
  "Ltd",
  "approx",
  "cf",
  "viz",
  "no",
  "v1",
  "v2",
  "v3",
  "v4",
]);

/** Trailing markdown link parenthetical belongs to previous sentence (spec-link-parser.ts). */
const TRAILING_LINK_PARENTHETICAL = /^\(\[[^\]]*\]\(/;

function indexOfNextNonSpace(text: string, from: number): number {
  let index = from;

  while (index < text.length && text[index] === " ") {
    index++;
  }

  return index;
}

function pushTrimmedNonEmpty(out: string[], text: string): void {
  const trimmed = text.trim();

  if (trimmed) {
    out.push(trimmed);
  }
}

function endsInAbbreviationOrInitial(buf: string): boolean {
  const trimmed = buf.trimEnd().replace(/[.?!]+$/, "");
  const lastWord = trimmed.split(/\s+/).pop() || "";

  if (ABBREVIATIONS.has(lastWord)) {
    return true;
  }

  return /^[A-Z]$/.test(lastWord);
}

const SENTENCE_ENDERS = new Set([".", "?", "!"]);

/** True when the punctuation at `ch` (with next non-space char at `j`) actually ends a sentence, vs. an abbreviation, initial, or trailing link parenthetical. */
function isSentenceBreak(
  flat: string,
  buf: string,
  ch: string,
  j: number,
): boolean {
  const nextCh = flat[j];

  if (!/[A-Z([0-9]/.test(nextCh)) {
    return false;
  }

  if (TRAILING_LINK_PARENTHETICAL.test(flat.slice(j))) {
    return false;
  }

  return !(ch === "." && endsInAbbreviationOrInitial(buf));
}

export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();

  if (!flat) {
    return [];
  }

  const out: string[] = [];
  let buf = "";

  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i];

    buf += ch;

    if (!SENTENCE_ENDERS.has(ch)) {
      continue;
    }

    const j = indexOfNextNonSpace(flat, i + 1);

    if (j >= flat.length) {
      pushTrimmedNonEmpty(out, buf);
      buf = "";
      break;
    }

    if (!isSentenceBreak(flat, buf, ch, j)) {
      continue;
    }

    out.push(buf.trim());
    buf = "";
    i = j - 1;
  }
  pushTrimmedNonEmpty(out, buf);

  return out;
}
