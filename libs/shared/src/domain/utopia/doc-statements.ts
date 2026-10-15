// One spec or ADR as Utopia statement items: a doc item (Repository contains Document contains Sections) and one item per statement (Section contains Statement, validated_by Tests, implemented_by SourceFiles, decided_by Adrs), each under Utopia's push limits.

import {
  linksForStatements,
  parseCodeLinksInStatement,
  resolveLinkPath,
  trailingLinkHrefs,
  type SpecLinkRef,
} from "../spec-link-parser.js";
import type { Statement as DocStatement } from "../spec-segment.js";
import {
  attribute,
  fitsOneItem,
  relation,
  type Entity,
  type Statement,
  type StatementItem,
} from "./statements.js";

export interface DocStatementsInput {
  repo: string;
  path: string;
  content: string;
  commit: string;
  /** ISO 8601 commit time, when the caller knows it. */
  commitTime?: string;
  kind: "spec" | "adr";
}

interface DocNames {
  repo: string;
  path: string;
  commit: string;
  doc: string;
  blob: string;
}

interface SectionRef {
  name: string;
  title: string;
  line: number;
}

interface Fragment {
  e: Entity[];
  s: Statement[];
}

type Unnamed = Omit<StatementItem, "externalId">;

const DOC_KIND_WORD = { spec: "Spec", adr: "Adr" } as const;

export function docStatementItems(input: DocStatementsInput): StatementItem[] {
  const names = namesOf(input);
  const sections = sectionsOf(input.content, names.doc);
  const docItems = splitToFit(`doc:${input.path}`, sections, (part) =>
    docItem(names, DOC_KIND_WORD[input.kind], part),
  );
  const perStatement = linksForStatements(input.content).flatMap(
    ({ statement, testLinks }) =>
      itemsOfStatement(names, sections, statement, testLinks),
  );

  return [...docItems, ...perStatement].map((pushed) =>
    input.commitTime ? { ...pushed, doc_time: input.commitTime } : pushed,
  );
}

function namesOf(input: DocStatementsInput): DocNames {
  return {
    repo: input.repo,
    path: input.path,
    commit: input.commit,
    doc: `${input.repo}:${input.path}`,
    blob: `https://github.com/${input.repo}/blob/${input.commit}`,
  };
}

/** Every heading outside a code fence, named by its slug; a repeated heading gets -2, -3 so names stay unique within the document. */
function sectionsOf(content: string, doc: string): SectionRef[] {
  const seen = new Map<string, number>();
  const sections: SectionRef[] = [];
  let inFence = false;

  content.split(/\r?\n/).forEach((line, index) => {
    inFence = /^\s*```/.test(line) ? !inFence : inFence;
    const heading = inFence ? null : /^#{1,6}\s+(\S.*)$/.exec(line);

    if (heading) {
      const title = heading[1].trim();
      const slug = uniqueSlug(slugOf(title), seen);

      sections.push({ name: `${doc}#${slug}`, title, line: index + 1 });
    }
  });

  return sections;
}

function uniqueSlug(slug: string, seen: Map<string, number>): string {
  const count = (seen.get(slug) ?? 0) + 1;

  seen.set(slug, count);

  return count === 1 ? slug : `${slug}-${count}`;
}

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function docItem(
  names: DocNames,
  kindWord: string,
  sections: SectionRef[],
): Unnamed {
  return {
    e: [
      [names.repo, "Repository", true],
      [names.doc, kindWord, true],
      ...sections.map((section): Entity => [section.name, "Section", true]),
    ],
    s: [
      relation(names.repo, "contains", names.doc),
      attribute(names.doc, "path", names.path),
      attribute(names.doc, "commit", names.commit),
      attribute(names.doc, "permalink", `${names.blob}/${names.path}`),
      ...sections.flatMap((section) => sectionStatements(names.doc, section)),
    ],
  };
}

function sectionStatements(doc: string, section: SectionRef): Statement[] {
  return [
    relation(doc, "contains", section.name),
    attribute(section.name, "title", section.title),
    attribute(section.name, "line_start", String(section.line)),
  ];
}

function itemsOfStatement(
  names: DocNames,
  sections: SectionRef[],
  statement: DocStatement,
  testLinks: SpecLinkRef[],
): StatementItem[] {
  const ordinal = String(statement.ordinal).padStart(4, "0");
  const name = `${names.doc}#s${ordinal}`;
  const head = statementHead(
    names,
    containerOf(names, sections, statement),
    name,
    statement.line ?? 1,
  );
  const links = linkFragments(names, name, statement, testLinks);

  return splitToFit(`stmt:${names.path}#${ordinal}`, links, (part) =>
    joinFragments(head, part),
  );
}

function statementHead(
  names: DocNames,
  container: Entity,
  name: string,
  line: number,
): Fragment {
  return {
    e: [container, [name, "Statement", true]],
    s: [
      relation(container[0], "contains", name),
      attribute(name, "line_start", String(line)),
      attribute(name, "permalink", `${names.blob}/${names.path}#L${line}`),
    ],
  };
}

/** The section the statement sits under: the last heading before its line, or the document itself for text before any heading. */
function containerOf(
  names: DocNames,
  sections: SectionRef[],
  statement: DocStatement,
): Entity {
  const line = statement.line ?? 1;
  const section = sections.filter((candidate) => candidate.line < line).at(-1);

  return section
    ? [section.name, "Section", true]
    : [names.doc, "Document", true];
}

function linkFragments(
  names: DocNames,
  statement: string,
  docStatement: DocStatement,
  testLinks: SpecLinkRef[],
): Fragment[] {
  return [
    ...testLinks.map((link) => testFragment(names, statement, link)),
    ...parseCodeLinksInStatement(docStatement.text).map((link) =>
      codeFragment(names, statement, link),
    ),
    ...adrPathsOf(names, docStatement.text).map((adrPath) =>
      adrFragment(names, statement, adrPath),
    ),
  ];
}

function testFragment(
  names: DocNames,
  statement: string,
  link: SpecLinkRef,
): Fragment {
  const path = resolveLinkPath(link.path, names.path);
  const title = link.label.replace(/^validated by\s+/i, "");
  const test = `${names.repo}:${path}::${title}`;
  const anchor = link.line === null ? "" : `#L${link.line}`;

  return {
    e: [[test, "Test", true]],
    s: [
      relation(statement, "validated_by", test),
      attribute(test, "title", title),
      attribute(test, "path", path),
      ...lineStartOf(test, link.line),
      attribute(test, "permalink", `${names.blob}/${path}${anchor}`),
    ],
  };
}

function lineStartOf(test: string, line: number | null): Statement[] {
  return line === null ? [] : [attribute(test, "line_start", String(line))];
}

function codeFragment(
  names: DocNames,
  statement: string,
  link: SpecLinkRef,
): Fragment {
  const path = resolveLinkPath(link.path, names.path);
  const file = `${names.repo}:${path}`;

  return {
    e: [[file, "SourceFile", true]],
    s: [
      relation(statement, "implemented_by", file),
      attribute(file, "path", path),
    ],
  };
}

const ADR_PATH = /^adrs\/.+\.md$/;

function adrPathsOf(names: DocNames, text: string): string[] {
  return trailingLinkHrefs(text)
    .map((href) => resolveLinkPath(href.replace(/#.*$/, ""), names.path))
    .filter((path) => ADR_PATH.test(path));
}

function adrFragment(
  names: DocNames,
  statement: string,
  adrPath: string,
): Fragment {
  const adr = `${names.repo}:${adrPath}`;

  return {
    e: [[adr, "Adr", true]],
    s: [relation(statement, "decided_by", adr)],
  };
}

/** Entities once each by name, in first-seen order, so a test two links name twice appears once in `e`. */
function joinFragments(head: Fragment, parts: Fragment[]): Unnamed {
  const byName = new Map<string, Entity>();

  for (const entity of [head, ...parts].flatMap((fragment) => fragment.e)) {
    byName.set(entity[0], byName.get(entity[0]) ?? entity);
  }

  return {
    e: [...byName.values()],
    s: [...head.s, ...parts.flatMap((fragment) => fragment.s)],
  };
}

/** Halves the parts until every item is under the push limits; the first item keeps the plain id and the rest take `.2`, `.3`, so an unsplit item's id never changes. */
function splitToFit<T>(
  externalId: string,
  parts: T[],
  build: (parts: T[]) => Unnamed,
): StatementItem[] {
  return fittingGroups(parts, build).map((group, index) => ({
    externalId: index === 0 ? externalId : `${externalId}.${index + 1}`,
    ...build(group),
  }));
}

function fittingGroups<T>(parts: T[], build: (parts: T[]) => Unnamed): T[][] {
  if (parts.length <= 1 || fitsOneItem({ externalId: "", ...build(parts) })) {
    return [parts];
  }
  const half = Math.ceil(parts.length / 2);

  return [
    ...fittingGroups(parts.slice(0, half), build),
    ...fittingGroups(parts.slice(half), build),
  ];
}
