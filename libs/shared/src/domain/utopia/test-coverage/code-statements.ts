// One source file as Utopia statement items: Repository contains SourceFile, the file defines each definition (a class and its methods, a function, an interface, a type, an enum) with its kind, whether it is exported, the hash of its declaration line, its lines and permalink; a class contains its methods, a class or interface extends and implements what it names, and a definition references what it calls, in the file or through a relative import; the file imports the files it names. No text of the file is copied.

import { extname, posix } from "node:path";
import { joinFragments, splitToFit, type Fragment } from "../fragments.js";
import { blobUrl, definitionName, fileName } from "../names.js";
import {
  attribute,
  knownAs,
  relation,
  sourceFileStatements,
  tombstone,
  type Entity,
  type Statement,
  type StatementItem,
  type Tombstone,
} from "../statements.js";

export type CodeDefinitionKind =
  "class" | "method" | "function" | "interface" | "type" | "enum";

/** A definition as the code ingest's parser reads it: bare-named at the top level, `Class.method` for a method of `container`. */
export interface CodeDefinition {
  name: string;
  kind: CodeDefinitionKind;
  exported: boolean;
  /** The content hash of the declaration line, null when the line is too short to anchor. */
  anchorHash: string | null;
  container?: string;
  extends: string[];
  implements: string[];
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
      ...sourceFileStatements(file, input.path),
      attribute(file, "permalink", `${blobUrl(input.repo)}/${input.path}`),
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
      ...sourceFileStatements(imported, target),
    ],
  };
}

function definitionFragment(
  input: CodeFileInput,
  symbol: CodeDefinition,
): Fragment {
  const definition = definitionName(input.repo, input.path, symbol.name);
  const linked = linkedDefinitions(input, symbol);

  return {
    e: [definition, ...Object.values(linked).flat()].map(codeDefinition),
    s: [
      relation(fileName(input.repo, input.path), "defines", definition),
      attribute(definition, "symbol", symbol.name),
      ...bareName(input, symbol).map((name) => knownAs(definition, name)),
      ...definitionAttributes(input, definition, symbol),
      ...linked.container.map((owner) =>
        relation(owner, "contains", definition),
      ),
      ...definitionRelations(definition, linked),
    ],
  };
}

/** What the definition extends, implements and references, in that order. */
function definitionRelations(
  definition: string,
  linked: ReturnType<typeof linkedDefinitions>,
): Statement[] {
  return (["extends", "implements", "references"] as const).flatMap((phrase) =>
    linked[phrase].map((target) => relation(definition, phrase, target)),
  );
}

/** The definitions one is linked to, each by its qualified name: the class containing a method, what it extends and implements, and what it calls. */
function linkedDefinitions(input: CodeFileInput, symbol: CodeDefinition) {
  return {
    container: symbol.container
      ? [definitionName(input.repo, input.path, symbol.container)]
      : [],
    extends: resolvedNames(input, symbol.extends),
    implements: resolvedNames(input, symbol.implements),
    references: referencedDefinitions(input, symbol),
  };
}

function definitionAttributes(
  input: CodeFileInput,
  definition: string,
  symbol: CodeDefinition,
): Statement[] {
  return [
    attribute(definition, "kind", symbol.kind),
    attribute(definition, "exported", String(symbol.exported)),
    ...(symbol.anchorHash
      ? [attribute(definition, "anchor_hash", symbol.anchorHash)]
      : []),
    attribute(definition, "line_start", String(symbol.startLine)),
    attribute(definition, "line_end", String(symbol.endLine)),
    attribute(definition, "permalink", definitionPermalink(input, symbol)),
  ];
}

/** The name a mention uses: a top-level definition's own, a method's bare name only when no other definition of the file has it, so `step` resolves to one entity. */
function bareName(input: CodeFileInput, symbol: CodeDefinition): string[] {
  const bare = symbol.name.slice(symbol.name.lastIndexOf(".") + 1);
  const holders = input.symbols.filter(
    (sibling) => sibling.name.slice(sibling.name.lastIndexOf(".") + 1) === bare,
  );

  return symbol.container && holders.length > 1 ? [] : [bare];
}

function codeDefinition(name: string): Entity {
  return [name, "CodeDefinition", true];
}

function definitionPermalink(
  input: CodeFileInput,
  symbol: CodeDefinition,
): string {
  const lines = `#L${symbol.startLine}-L${symbol.endLine}`;

  return `${blobUrl(input.repo)}/${input.path}${lines}`;
}

/** What a definition calls, by the name it has where it is defined: a sibling in this file, or a named import from a relative path. Recursion and calls into packages are left out. */
function referencedDefinitions(
  input: CodeFileInput,
  symbol: CodeDefinition,
): string[] {
  return resolvedNames(
    input,
    [...new Set(symbol.calls)].filter((call) => call !== symbol.name),
  );
}

/** Each name as the definition it binds here: a sibling of this file, or a named import from a relative path; a name from a package, or an unknown one, is dropped. */
function resolvedNames(input: CodeFileInput, names: string[]): string[] {
  const siblings = new Set(input.symbols.map((sibling) => sibling.name));
  const byLocal = new Map(
    input.imports.map((binding) => [binding.local, binding]),
  );

  return names.flatMap((name) =>
    siblings.has(name)
      ? [definitionName(input.repo, input.path, name)]
      : importedDefinition(input, byLocal.get(name)),
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
