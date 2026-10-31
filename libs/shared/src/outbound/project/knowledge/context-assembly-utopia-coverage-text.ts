// Reads the statement tuple a `stmt:`, `code:` or `test:` item of the `test-coverage` source is searched as (the shape domain/utopia/statements.ts pushes) into the readable lines of a coupling or code item.

import type { Entity, Statement } from "../../../domain/utopia/statements.js";

interface Tuple {
  e: Entity[];
  s: Statement[];
}

/** The item's lines, or the hit text as it came when it is no tuple (a chunk of a split item). */
export function coverageText(externalId: string, hitText: string): string {
  const tuple = parseTuple(hitText);

  if (!tuple) {
    return `${externalId}\n${hitText.trim()}`.trim();
  }
  const render = RENDERERS[externalId.slice(0, externalId.indexOf(":"))];

  return (render ? render(externalId, tuple) : [externalId]).join("\n");
}

const RENDERERS: Record<
  string,
  ((externalId: string, tuple: Tuple) => string[]) | undefined
> = { stmt: statementLines, test: testLines, code: codeLines };

function parseTuple(text: string): Tuple | null {
  try {
    const parsed: Partial<Tuple> = JSON.parse(text);

    return Array.isArray(parsed.e) && Array.isArray(parsed.s)
      ? { e: parsed.e, s: parsed.s }
      : null;
  } catch {
    return null;
  }
}

function statementLines(externalId: string, tuple: Tuple): string[] {
  const [statement] = namesOfKind(tuple, "Statement");
  const tests = objectsOf(tuple, statement, "validated_by");
  const files = objectsOf(tuple, statement, "implemented_by");

  return [
    `${externalId.slice("stmt:".length)}: ${valueOf(tuple, statement, "text")}`,
    ...tests.map((test) => `  validated by ${located(tuple, test)}`),
    ...files.map((file) => `  implemented by ${fileOf(tuple, file)}`),
  ];
}

function testLines(_externalId: string, tuple: Tuple): string[] {
  return namesOfKind(tuple, "Test").flatMap((test) => [
    `${located(tuple, test)} outcome=${valueOf(tuple, test, "outcome")}`,
    ...coveredLines(tuple, test),
    ...subjectsOf(tuple, "validated_by", test).map(
      (statement) => `  validates ${statement}`,
    ),
  ]);
}

function coveredLines(tuple: Tuple, test: string): string[] {
  return tuple.s.flatMap((row) =>
    row[1] === test && row[2] === "covers" && row[3]
      ? [`  covers ${fileOf(tuple, row[3])} lines ${row[5].lines}`]
      : [],
  );
}

function codeLines(externalId: string, tuple: Tuple): string[] {
  const [file] = namesOfKind(tuple, "SourceFile");
  const symbols = objectsOf(tuple, file, "defines");

  return [
    file ? fileOf(tuple, file) : externalId.slice("code:".length),
    ...symbols.map((symbol) => `  defines ${symbolSpan(tuple, symbol)}`),
  ];
}

function symbolSpan(tuple: Tuple, symbol: string): string {
  const start = valueOf(tuple, symbol, "line_start");
  const end = valueOf(tuple, symbol, "line_end");

  return `${valueOf(tuple, symbol, "symbol")} (L${start}-L${end})`;
}

function located(tuple: Tuple, test: string): string {
  const path = valueOf(tuple, test, "path");
  const line = valueOf(tuple, test, "line_start");

  return `${valueOf(tuple, test, "title")} (${path}:${line})`;
}

function fileOf(tuple: Tuple, file: string): string {
  return valueOf(tuple, file, "path") || file;
}

function namesOfKind(tuple: Tuple, kind: string): string[] {
  return tuple.e.flatMap(([name, entityKind]) =>
    entityKind === kind ? [name] : [],
  );
}

function objectsOf(tuple: Tuple, subject: string, phrase: string): string[] {
  return tuple.s.flatMap((row) =>
    row[1] === subject && row[2] === phrase && row[3] ? [row[3]] : [],
  );
}

function subjectsOf(tuple: Tuple, phrase: string, object: string): string[] {
  return tuple.s.flatMap((row) =>
    row[2] === phrase && row[3] === object ? [row[1]] : [],
  );
}

function valueOf(tuple: Tuple, subject: string, phrase: string): string {
  const row = tuple.s.find((s) => s[1] === subject && s[2] === phrase);

  return row?.[4] ?? row?.[3] ?? "";
}
