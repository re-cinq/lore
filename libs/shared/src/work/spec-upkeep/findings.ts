// What a repository's specs need, read from the traceability graph with no model call: statements a failing test or the projection says have drifted, and testable statements no test validates. Each is rendered as the brief the upkeep agent works from.
import { enforceTrue } from "../../lib/enforce.js";
import type { TraceDocument } from "../../domain/spec-trace/assemble-trace-document.js";
import {
  decideGraphDrift,
  isAssertionSource,
  type DriftedStatement,
} from "./spec-drift-rules.js";

export interface UpkeepSources {
  /** Every spec path the repository holds. */
  specPaths(): Promise<string[]>;
  document(specPath: string): Promise<TraceDocument>;
}

export interface DriftedSpec {
  specPath: string;
  statements: DriftedStatement[];
}

export interface UnlinkedStatement {
  text: string;
  ordinal: number;
  section?: string;
}

export interface UnlinkedSpec {
  specPath: string;
  statements: UnlinkedStatement[];
}

/** The specs with a drifted statement, `maxSpecs` at most: a pull request that rewrites more than a few specs is one nobody reviews. */
export async function findDrift(
  sources: UpkeepSources,
  maxSpecs: number,
): Promise<DriftedSpec[]> {
  const drifted: DriftedSpec[] = [];

  for (const doc of await documentsOf(sources)) {
    const { statements } = decideGraphDrift(doc);

    if (statements.length > 0 && drifted.length < maxSpecs) {
      drifted.push({ specPath: doc.filePath, statements });
    }
  }

  return drifted;
}

/** The testable statements no test validates, `maxStatements` at most across the repository. */
export async function findUnlinked(
  sources: UpkeepSources,
  maxStatements: number,
): Promise<UnlinkedSpec[]> {
  const unlinked: UnlinkedSpec[] = [];
  let room = maxStatements;

  for (const doc of await documentsOf(sources)) {
    const statements = untestedOf(doc).slice(0, room);

    room -= statements.length;

    if (statements.length > 0) {
      unlinked.push({ specPath: doc.filePath, statements });
    }
  }

  return unlinked;
}

/** The documents worth reading: prose artifacts assert nothing, and a spec the graph cannot be read for is left for the next run. When specs are listed and NONE can be read, the graph is down, and saying "nothing to fix" would pass a week having examined nothing: that throws, so the station fails and is retried. */
async function documentsOf(sources: UpkeepSources): Promise<TraceDocument[]> {
  const paths = (await sources.specPaths()).filter(isAssertionSource);
  const read = await Promise.all(
    paths.map((path) => sources.document(path).catch(() => null)),
  );
  const documents = read.filter((doc) => doc !== null);

  enforceTrue(
    paths.length === 0 || documents.length > 0,
    Error,
    `none of the ${paths.length} spec(s) could be read from the traceability graph`,
  );

  return documents;
}

function untestedOf(doc: TraceDocument): UnlinkedStatement[] {
  const headings = new Map(doc.sections.map((s) => [s.uid, s.heading]));
  const untested = doc.statements.filter(
    (statement) => statement.state === "untested",
  );

  return untested.map(({ text, ordinal, sectionUid }) => ({
    text,
    ordinal,
    section: sectionUid ? headings.get(sectionUid) : undefined,
  }));
}

const WHY: Record<DriftedStatement["reason"], string> = {
  violated: "a test bound to this statement fails",
  drifted: "the projection flagged this statement as drifted from the code",
};

export function driftBrief(drifted: readonly DriftedSpec[]): string {
  const specs = drifted.map(({ specPath, statements }) =>
    [`## ${specPath}`, "", ...statements.flatMap(driftLines), ""].join("\n"),
  );

  return ["# Drifted statements", "", ...specs].join("\n");
}

function driftLines(statement: DriftedStatement): string[] {
  const tests = statement.links.filter(
    (link) => link.kind === "test" && link.path,
  );

  return [
    statementLine(statement),
    `  - Why: ${WHY[statement.reason]}`,
    ...tests.map(testLine),
  ];
}

function testLine(link: DriftedStatement["links"][number]): string {
  const line = link.line ? `:${link.line}` : "";

  return `  - Test: ${link.path}${line} (${link.label})`;
}

export function unlinkedBrief(unlinked: readonly UnlinkedSpec[]): string {
  const specs = unlinked.map(({ specPath, statements }) =>
    [`## ${specPath}`, "", ...statements.map(statementLine), ""].join("\n"),
  );

  return ["# Statements with no test link", "", ...specs].join("\n");
}

function statementLine(statement: UnlinkedStatement): string {
  const where = statement.section ? ` (${statement.section})` : "";

  return `- Statement ${statement.ordinal}${where}: ${statement.text}`;
}
