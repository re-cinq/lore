// Reads the statement tuple a `stmt:`, `code:` or `test:` item of the `test-coverage` source is searched as (the shape domain/utopia/statements.ts pushes) into the readable lines of a coupling or code item.

import type { Entity, Statement } from "../../../domain/utopia/statements.js";

interface Tuple {
  e: Entity[];
  s: Statement[];
}

/** Lines of one file a coupling item cites: a test from its first line to its last (null when the push knew no last line), or a range a test covers. */
export interface Span {
  path: string;
  start: number;
  end: number | null;
}

/** The spans a `stmt:` or `test:` tuple cites, in the order the item names them: each test a statement is validated by, or the test itself then each range it covers; nothing for a `code:` item or a chunk that is no tuple. */
export function citedSpans(externalId: string, hitText: string): Span[] {
  const tuple = parseTuple(hitText);
  const kind = externalId.slice(0, externalId.indexOf(":"));

  if (!tuple || (kind !== "stmt" && kind !== "test")) {
    return [];
  }
  const [statement] = namesOfKind(tuple, "Statement");
  const tests =
    kind === "stmt"
      ? objectsOf(tuple, statement, "validated_by")
      : namesOfKind(tuple, "Test");

  return tests.flatMap((test) => [
    testSpan(tuple, test),
    ...(kind === "test" ? coveredSpans(tuple, test) : []),
  ]);
}

function testSpan(tuple: Tuple, test: string): Span {
  const end = valueOf(tuple, test, "line_end");

  return {
    path: valueOf(tuple, test, "path"),
    start: Number(valueOf(tuple, test, "line_start")),
    end: end ? Number(end) : null,
  };
}

/** `7-7,9-14` of a `covers` row read as one span per range. */
function coveredSpans(tuple: Tuple, test: string): Span[] {
  return tuple.s.flatMap((row) => {
    const file = row[1] === test && row[2] === "covers" ? row[3] : null;

    return file
      ? String(row[5].lines)
          .split(",")
          .filter((range) => range !== "")
          .map((range) => rangeSpan(fileOf(tuple, file), range))
      : [];
  });
}

function rangeSpan(path: string, range: string): Span {
  const bounds = range.split("-").map(Number);

  return { path, start: bounds[0], end: bounds[bounds.length - 1] };
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
    ...files.map((file) => `  implemented by ${implementer(tuple, file)}`),
  ];
}

/** A definition by its bare symbol, a file by its path. */
function implementer(tuple: Tuple, object: string): string {
  return valueOf(tuple, object, "symbol") || fileOf(tuple, object);
}

function testLines(_externalId: string, tuple: Tuple): string[] {
  return namesOfKind(tuple, "Test").flatMap((test) => [
    `${located(tuple, test)}${hashed(tuple, test)} outcome=${valueOf(tuple, test, "outcome")}`,
    ...coveredLines(tuple, test),
    ...subjectsOf(tuple, "validated_by", test).map(
      (statement) => `  validates ${statement}`,
    ),
  ]);
}

function hashed(tuple: Tuple, test: string): string {
  const hash = valueOf(tuple, test, "anchor_hash");

  return hash ? ` @${hash}` : "";
}

function coveredLines(tuple: Tuple, test: string): string[] {
  return tuple.s.flatMap((row) =>
    row[1] === test && row[2] === "covers" && row[3]
      ? [`  covers ${fileOf(tuple, row[3])} lines ${row[5].lines}`]
      : [],
  );
}

/** The file, then each definition it defines on its own line, a method indented under the class that contains it. */
function codeLines(externalId: string, tuple: Tuple): string[] {
  const [file] = namesOfKind(tuple, "SourceFile");
  const methods = containedDefinitions(tuple);
  const topLevel = objectsOf(tuple, file, "defines").filter(
    (symbol) => !methods.has(symbol),
  );

  return [
    file ? fileOf(tuple, file) : externalId.slice("code:".length),
    ...topLevel.flatMap((symbol) => [
      `  ${definitionLine(tuple, symbol)}`,
      ...objectsOf(tuple, symbol, "contains").map(
        (method) => `    ${definitionLine(tuple, method)}`,
      ),
    ]),
  ];
}

/** The definitions a definition contains: a class's methods, drawn under it rather than at the top level. */
function containedDefinitions(tuple: Tuple): Set<string> {
  const definitions = new Set(namesOfKind(tuple, "CodeDefinition"));

  return new Set(
    tuple.s.flatMap((row) =>
      row[2] === "contains" && row[3] && definitions.has(row[1])
        ? [row[3]]
        : [],
    ),
  );
}

/** `<kind> <symbol> (L<start>-L<end>[, exported])` and what it extends, implements and references, each by bare symbol. */
function definitionLine(tuple: Tuple, symbol: string): string {
  const start = valueOf(tuple, symbol, "line_start");
  const end = valueOf(tuple, symbol, "line_end");
  const exported = valueOf(tuple, symbol, "exported") === "true";
  const kind = valueOf(tuple, symbol, "kind");
  const head = `${kind ? `${kind} ` : ""}${valueOf(tuple, symbol, "symbol")} (L${start}-L${end}${exported ? ", exported" : ""})`;
  const links = ["extends", "implements", "references"].flatMap((phrase) => {
    const targets = objectsOf(tuple, symbol, phrase);

    return targets.length > 0
      ? [
          `${phrase} ${targets.map((target) => bareSymbol(tuple, target)).join(", ")}`,
        ]
      : [];
  });

  return [head, ...links].join(" ");
}

/** A definition's `symbol` row, or the part of its name after the last `#` for one the item only names. */
function bareSymbol(tuple: Tuple, definition: string): string {
  return (
    valueOf(tuple, definition, "symbol") ||
    definition.slice(definition.lastIndexOf("#") + 1)
  );
}

function located(tuple: Tuple, test: string): string {
  const path = valueOf(tuple, test, "path");
  const line = valueOf(tuple, test, "line_start");

  return `${valueOf(tuple, test, "title")} (${path}:${line})`;
}

/** The file's `path` row, or its entity name with the leading `<repo>:` dropped when the item only names the file. */
function fileOf(tuple: Tuple, file: string): string {
  const path = valueOf(tuple, file, "path");
  const [repo] = namesOfKind(tuple, "Repository");

  return (
    path ||
    (repo && file.startsWith(`${repo}:`) ? file.slice(repo.length + 1) : file)
  );
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
