// One spec, ADR or other markdown document as Utopia statement items: a doc item (Repository contains Document contains Sections, with the document's title and each heading's text) and one item per statement (its text, Section contains Statement, validated_by Tests, implemented_by SourceFiles, decided_by Adrs), each under Utopia's push limits.

import {
  linksForStatements,
  parseCodeLinksInStatement,
  resolveLinkPath,
  trailingLinkHrefs,
  type SpecLinkRef,
} from "../../spec-link-parser.js";
import type { Statement as DocStatement } from "../../spec-segment.js";
import { stripCoverageLinks } from "../../spec-link-strip.js";
import { testTitleAt } from "../../spec-trace/test-declarations.js";
import {
  cutText,
  joinFragments,
  splitToFit,
  type Fragment,
} from "../fragments.js";
import { blobUrl, fileName, statementName, testName } from "../names.js";
import {
  attribute,
  relation,
  type Entity,
  type Statement,
  type StatementItem,
} from "../statements.js";

export interface DocStatementsInput {
  repo: string;
  path: string;
  content: string;
  commit: string;
  /** ISO 8601 commit time, when the caller knows it. */
  commitTime?: string;
  kind: MirroredDocKind;
  /** Linked test files' source at the commit, by repo path: a link whose label is no title is named by the test declared at its anchor. */
  testSources?: ReadonlyMap<string, string>;
}

interface DocNames {
  repo: string;
  path: string;
  commit: string;
  doc: string;
  /** The document's own class, so every place that names it names one entity. */
  kindWord: string;
  blob: string;
  testSources: ReadonlyMap<string, string>;
}

interface SectionRef {
  name: string;
  title: string;
  line: number;
  depth: number;
}

const DOC_KIND_WORD = { spec: "Spec", adr: "Adr", doc: "Doc" } as const;

export type MirroredDocKind = keyof typeof DOC_KIND_WORD;

export function docStatementItems(input: DocStatementsInput): StatementItem[] {
  const names = namesOf(input);
  const sections = sectionsOf(input.content, names.doc);
  const head = docHead(names, sections);
  const docItems = splitToFit(`doc:${input.path}`, sections, (part) =>
    joinFragments(
      head,
      part.map((section) => sectionFragment(names.doc, section)),
    ),
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
    doc: fileName(input.repo, input.path),
    kindWord: DOC_KIND_WORD[input.kind],
    blob: blobUrl(input.repo, input.commit),
    testSources: input.testSources ?? new Map(),
  };
}

/** Every heading outside a code fence, named by its slug; a repeated heading gets -2, -3 so names stay unique within the document. */
function sectionsOf(content: string, doc: string): SectionRef[] {
  const seen = new Map<string, number>();
  const sections: SectionRef[] = [];
  let inFence = false;

  content.split(/\r?\n/).forEach((line, index) => {
    inFence = /^\s*```/.test(line) ? !inFence : inFence;
    const heading = inFence ? null : /^(#{1,6})\s+(\S.*)$/.exec(line);

    if (heading) {
      const title = heading[2].trim();
      const slug = uniqueSlug(slugOf(title), seen);

      sections.push({
        name: `${doc}#${slug}`,
        title,
        line: index + 1,
        depth: heading[1].length,
      });
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

/** What every part of a split doc item repeats: the repository, the document and its attributes, its title being its first top-level heading. */
function docHead(names: DocNames, sections: SectionRef[]): Fragment {
  const top = sections.find((section) => section.depth === 1);

  return {
    e: [
      [names.repo, "Repository", true],
      [names.doc, names.kindWord, true],
    ],
    s: [
      relation(names.repo, "contains", names.doc),
      attribute(names.doc, "path", names.path),
      attribute(names.doc, "commit", names.commit),
      attribute(names.doc, "permalink", `${names.blob}/${names.path}`),
      ...(top ? [attribute(names.doc, "title", top.title)] : []),
    ],
  };
}

function sectionFragment(doc: string, section: SectionRef): Fragment {
  return {
    e: [[section.name, "Section", true]],
    s: [
      relation(doc, "contains", section.name),
      attribute(section.name, "title", section.title),
      attribute(section.name, "text", section.title),
      attribute(section.name, "line_start", String(section.line)),
    ],
  };
}

function itemsOfStatement(
  names: DocNames,
  sections: SectionRef[],
  statement: DocStatement,
  testLinks: SpecLinkRef[],
): StatementItem[] {
  const ordinal = String(statement.ordinal).padStart(4, "0");
  const name = statementName(names.repo, names.path, statement.ordinal);
  const head = statementHead(
    names,
    containerOf(names, sections, statement),
    name,
    statement.line ?? 1,
  );
  const parts = statementParts(names, name, statement, testLinks);

  return splitToFit(`stmt:${names.path}#${ordinal}`, parts, (part) =>
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
    : [names.doc, names.kindWord, true];
}

/** The words go first, so a statement split across items carries them on its first item alone. */
function statementParts(
  names: DocNames,
  statement: string,
  docStatement: DocStatement,
  testLinks: SpecLinkRef[],
): Fragment[] {
  return [
    textFragment(statement, docStatement.text),
    ...testLinks.flatMap((link) => testFragment(names, statement, link)),
    ...parseCodeLinksInStatement(docStatement.text).map((link) =>
      codeFragment(names, statement, link),
    ),
    ...adrPathsOf(names, docStatement.text).map((adrPath) =>
      adrFragment(names, statement, adrPath),
    ),
  ];
}

function textFragment(name: string, text: string): Fragment {
  return { e: [], s: [attribute(name, "text", pushedText(text))] };
}

/** Utopia searches and cites these words: the links are traceability the relations already carry. */
function pushedText(text: string): string {
  return cutText(stripCoverageLinks(text));
}

/** The test the link names, or nothing when neither its label nor the source at its anchor gives the test's title. */
function testFragment(
  names: DocNames,
  statement: string,
  link: SpecLinkRef,
): Fragment[] {
  const path = resolveLinkPath(link.path, names.path);
  const title = labelTitle(link.label) ?? sourceTitle(names, path, link.line);

  return title === null
    ? []
    : [titledTestFragment(names, statement, { path, title, line: link.line })];
}

function titledTestFragment(
  names: DocNames,
  statement: string,
  linked: { path: string; title: string; line: number | null },
): Fragment {
  const test = testName(names.repo, linked.path, linked.title);
  const anchor = linked.line === null ? "" : `#L${linked.line}`;

  return {
    e: [[test, "Test", true]],
    s: [
      relation(statement, "validated_by", test),
      attribute(test, "title", linked.title),
      attribute(test, "path", linked.path),
      ...lineStartOf(test, linked.line),
      attribute(test, "permalink", `${names.blob}/${linked.path}${anchor}`),
    ],
  };
}

/** A `file.test.ts:21` label names where a test once stood, not what it is called. */
const FILE_LINE_LABEL = /^[^\s:]+:\d+$/;

/** The label after "validated by", its backticks dropped; null when that leaves nothing or a `file:line`. */
function labelTitle(label: string): string | null {
  const title = label
    .replace(/^validated by\b\s*/i, "")
    .replace(/^`(.*)`$/, "$1")
    .trim();

  return title === "" || FILE_LINE_LABEL.test(title) ? null : title;
}

function sourceTitle(
  names: DocNames,
  path: string,
  line: number | null,
): string | null {
  const source = names.testSources.get(path);

  return source === undefined || line === null
    ? null
    : testTitleAt(source, line);
}

/** The test files whose links' labels give no title, once each in link order: the files {@link DocStatementsInput.testSources} needs. */
export function untitledTestPaths(
  input: Pick<DocStatementsInput, "path" | "content">,
): string[] {
  const paths = linksForStatements(input.content)
    .flatMap(({ testLinks }) => testLinks)
    .filter((link) => labelTitle(link.label) === null)
    .map((link) => resolveLinkPath(link.path, input.path));

  return [...new Set(paths)];
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
  const file = fileName(names.repo, path);

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
  const adr = fileName(names.repo, adrPath);

  return {
    e: [[adr, "Adr", true]],
    s: [relation(statement, "decided_by", adr)],
  };
}
