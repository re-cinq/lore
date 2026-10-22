// One source file as Utopia statement items: Repository contains SourceFile, the file defines each top-level definition with its lines and permalink, a definition references what it calls in the file or through a relative import, and the file imports the files it names. No text of the file is copied.

import { extname, posix } from "node:path";
import { joinFragments, splitToFit, type Fragment } from "../fragments.js";
import { blobUrl, definitionName, fileName } from "../names.js";
import {
  attribute,
  relation,
  tombstone,
  type Entity,
  type StatementItem,
  type Tombstone,
} from "../statements.js";

/** A top-level definition as the code ingest's parser reads it. */
export interface CodeDefinition {
  name: string;
  startLine: number;
  endLine: number;
  calls: string[];
}

/** One named import: the name the file uses, the name the module exports, and the module path as written. */
export interface CodeImport {
  local: string;
  imported: string;
  fromPath: string;
}

export interface CodeFileInput {
  repo: string;
  path: string;
  commit: string;
  symbols: CodeDefinition[];
  imports: CodeImport[];
}

export function codeFileItems(input: CodeFileInput): StatementItem[] {
  const parts = [
    ...importedFiles(input).map((target) => importFragment(input, target)),
    ...input.symbols.map((symbol) => definitionFragment(input, symbol)),
  ];

  return splitToFit(`code:${input.path}`, parts, (part) =>
    joinFragments(fileHead(input), part),
  );
}

export function codeFileTombstones(paths: string[]): Tombstone[] {
  return paths.map((path) => tombstone(`code:${path}`));
}

function fileHead(input: CodeFileInput): Fragment {
  const file = fileName(input.repo, input.path);

  return {
    e: [
      [input.repo, "Repository", true],
      [file, "SourceFile", true],
    ],
    s: [
      relation(input.repo, "contains", file),
      attribute(file, "path", input.path),
      attribute(file, "commit", input.commit),
      attribute(
        file,
        "permalink",
        `${blobUrl(input.repo, input.commit)}/${input.path}`,
      ),
    ],
  };
}

/** The in-repo files the file imports from, once each; a package import names no file of the repo. */
function importedFiles(input: CodeFileInput): string[] {
  const targets = input.imports.flatMap(
    (binding) => resolvedImport(input.path, binding.fromPath) ?? [],
  );

  return [...new Set(targets)];
}

/** `./a.js` from `src/x/b.ts` is `src/x/a.ts`: the compiled extension names the importer's source one. */
function resolvedImport(importer: string, fromPath: string): string | null {
  if (!fromPath.startsWith(".")) {
    return null;
  }
  const target = posix.normalize(posix.join(posix.dirname(importer), fromPath));

  return extname(target) === ".js"
    ? `${target.slice(0, -".js".length)}${extname(importer)}`
    : target;
}

function importFragment(input: CodeFileInput, target: string): Fragment {
  const imported = fileName(input.repo, target);

  return {
    e: [[imported, "SourceFile", true]],
    s: [
      relation(fileName(input.repo, input.path), "imports", imported),
      attribute(imported, "path", target),
    ],
  };
}

function definitionFragment(
  input: CodeFileInput,
  symbol: CodeDefinition,
): Fragment {
  const definition = definitionName(input.repo, input.path, symbol.name);
  const callees = referencedDefinitions(input, symbol);

  return {
    e: [definition, ...callees].map(codeDefinition),
    s: [
      relation(fileName(input.repo, input.path), "defines", definition),
      attribute(definition, "symbol", symbol.name),
      attribute(definition, "line_start", String(symbol.startLine)),
      attribute(definition, "line_end", String(symbol.endLine)),
      attribute(definition, "permalink", definitionPermalink(input, symbol)),
      ...callees.map((callee) => relation(definition, "references", callee)),
    ],
  };
}

function codeDefinition(name: string): Entity {
  return [name, "CodeDefinition", true];
}

function definitionPermalink(
  input: CodeFileInput,
  symbol: CodeDefinition,
): string {
  const lines = `#L${symbol.startLine}-L${symbol.endLine}`;

  return `${blobUrl(input.repo, input.commit)}/${input.path}${lines}`;
}

/** What a definition calls, by the name it has where it is defined: a sibling in this file, or a named import from a relative path. Recursion and calls into packages are left out. */
function referencedDefinitions(
  input: CodeFileInput,
  symbol: CodeDefinition,
): string[] {
  const siblings = new Set(input.symbols.map((sibling) => sibling.name));
  const byLocal = new Map(
    input.imports.map((binding) => [binding.local, binding]),
  );

  return [...new Set(symbol.calls)]
    .filter((call) => call !== symbol.name)
    .flatMap((call) =>
      siblings.has(call)
        ? [definitionName(input.repo, input.path, call)]
        : importedDefinition(input, byLocal.get(call)),
    );
}

function importedDefinition(
  input: CodeFileInput,
  binding: CodeImport | undefined,
): string[] {
  const target = binding ? resolvedImport(input.path, binding.fromPath) : null;

  return binding && target
    ? [definitionName(input.repo, target, binding.imported)]
    : [];
}
