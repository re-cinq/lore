/** Parses the `.lore/dod.md` the acceptance-dod recipe commits (specs/implementation-loop FR6): a `# Definition of Done` title, the ticket claim as a blockquote, a bold `Strategy:` line, then the `Done when these pass` / `Facets` / `Out of scope` sections. Pure; a document without the title is not a definition of done. */

export interface DodAcceptanceTest {
  path: string;
  name: string;
  behaviour: string;
  done: boolean;
}

export interface DodFacet {
  text: string;
  done: boolean;
}

export interface DefinitionOfDone {
  ticketClaim: string;
  strategy: string;
  why: string;
  acceptanceTests: DodAcceptanceTest[];
  facets: DodFacet[];
  outOfScope: string[];
}

const TITLE = /^#\s+definition of done\s*$/im;
const SECTION_HEADING = /^##\s+(.+?)\s*$/;
const CHECKBOX = /^\[([ xX])\]\s*/;
const BOLD_NAME = /^\*\*(.+?)\*\*\s*/;
const PATH_IN_BACKTICKS = /`([^`\s]+\.[A-Za-z0-9]+)`/;
const DASH = /^(?:—|–|-)\s+/;
const SEPARATOR = /\s+(?:—|–|-)\s+/;
const STRATEGY_LINE = /^\*\*Strategy:\s*`?([\w-]+)`?\s*\*\*\s*(.*)$/s;

interface Sections {
  preamble: string[];
  byName: Map<string, string[]>;
}

/** The parsed definition, or null when the text carries no `# Definition of Done` title. */
export function parseDodMarkdown(text: string): DefinitionOfDone | null {
  if (!TITLE.test(text)) {
    return null;
  }
  const sections = splitSections(text);

  return {
    ticketClaim: ticketClaim(sections.preamble),
    ...strategy(sections.preamble),
    acceptanceTests: listEntries(
      sections,
      "done when these pass",
      "acceptance tests",
    ).map(acceptanceTest),
    facets: listEntries(sections, "facets").map(facet),
    outOfScope: listEntries(sections, "out of scope").map((entry) =>
      entry.trim(),
    ),
  };
}

/** Everything under the title, cut at each `## ` heading; section names are compared lower-cased. */
function splitSections(text: string): Sections {
  const byName = new Map<string, string[]>();
  const preamble: string[] = [];
  let current = preamble;

  for (const line of text.split(/\r?\n/)) {
    const heading = SECTION_HEADING.exec(line);

    if (heading) {
      current = [];
      byName.set(heading[1].toLowerCase(), current);
      continue;
    }
    current.push(line);
  }

  return { preamble, byName };
}

/** The blockquote lines of the preamble joined into one claim. */
function ticketClaim(preamble: string[]): string {
  return preamble
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

/** `**Strategy: \`direct\`** — why`, the why continuing over the following non-blank lines. */
function strategy(preamble: string[]): { strategy: string; why: string } {
  const at = preamble.findIndex((line) => /^\*\*Strategy:/i.test(line));
  const paragraph = at === -1 ? [] : paragraphFrom(preamble.slice(at));
  const match = STRATEGY_LINE.exec(paragraph.join(" "));

  return {
    strategy: match?.[1] ?? "",
    why: (match?.[2] ?? "").replace(/^(?:—|–|-|:)\s*/, "").trim(),
  };
}

/** The trimmed lines up to the first blank one. */
function paragraphFrom(lines: string[]): string[] {
  const blankAt = lines.findIndex((line) => line.trim() === "");

  return (blankAt === -1 ? lines : lines.slice(0, blankAt)).map((line) =>
    line.trim(),
  );
}

/** The first named section's top-level `- ` entries, each with its indented continuation lines folded in. */
function listEntries(sections: Sections, ...names: string[]): string[] {
  const lines = names.map((name) => sections.byName.get(name)).find(Boolean);
  const entries: string[] = [];

  for (const line of lines ?? []) {
    if (/^-\s/.test(line)) {
      entries.push(line.replace(/^-\s+/, ""));
      continue;
    }

    if (line.trim() !== "" && entries.length > 0) {
      entries[entries.length - 1] += ` ${line.trim()}`;
    }
  }

  return entries;
}

/** `**name** — behaviour \`path\`` (the template) or the earlier `path::name — behaviour` line. */
function acceptanceTest(entry: string): DodAcceptanceTest {
  const { done, rest } = checkbox(entry);
  const bold = BOLD_NAME.exec(rest);

  return bold
    ? { ...templateAcceptanceTest(rest, bold), done }
    : { ...legacyAcceptanceTest(rest), done };
}

function templateAcceptanceTest(
  rest: string,
  bold: RegExpExecArray,
): Omit<DodAcceptanceTest, "done"> {
  const behaviour = rest
    .slice(bold[0].length)
    .replace(PATH_IN_BACKTICKS, "")
    .replace(DASH, "")
    .trim();

  return {
    path: PATH_IN_BACKTICKS.exec(rest)?.[1] ?? "",
    name: bold[1].trim(),
    behaviour,
  };
}

function legacyAcceptanceTest(rest: string): Omit<DodAcceptanceTest, "done"> {
  const [head, ...tail] = rest.split(SEPARATOR);
  const at = head.indexOf("::");

  return {
    path: at === -1 ? "" : head.slice(0, at).trim(),
    name: (at === -1 ? head : head.slice(at + 2)).trim(),
    behaviour: tail.join(" ").trim(),
  };
}

function facet(entry: string): DodFacet {
  const { done, rest } = checkbox(entry);

  return { text: rest.trim(), done };
}

function checkbox(entry: string): { done: boolean; rest: string } {
  const box = CHECKBOX.exec(entry);

  if (!box) {
    return { done: false, rest: entry };
  }

  return { done: box[1] !== " ", rest: entry.slice(box[0].length) };
}
