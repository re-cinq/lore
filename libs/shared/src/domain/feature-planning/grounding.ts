// Whether the names a generated spec or task issue puts in backticks exist on main: a path must be in the tree, an identifier in the file the same line names, and nothing retired may be named. The planning line's coverage stations send the writer back with these findings.

export interface GroundingInput {
  text: string;
  /** Every file path on main. */
  tree: readonly string[];
  /** The contents of the files the text names, keyed by path. */
  files: Readonly<Record<string, string>>;
  /** Paths another artifact of the same plan says the feature adds (`declaredNewPaths`). */
  added?: readonly string[];
}

export interface GroundingFinding {
  name: string;
  kind: "path" | "identifier" | "retired";
  /** 1-based line of the text the name is on. */
  line: number;
  hint?: string;
}

interface Retired {
  name: string;
  isNamed(line: string): boolean;
  hint: string;
}

const RETIRED: readonly Retired[] = [
  {
    name: "apps/floor",
    isNamed: (line) => /(^|[\s(`])apps\/floor(\/|`|\s|$)/.test(line),
    hint: "deleted 2026-10-02; lines run on the external floor, Lore's steps are stations in apps/stations",
  },
  {
    name: "Event Router",
    isNamed: (line) => /event[- ]router/i.test(line),
    hint: "folded into lore-api on 2026-10-02 (ADR-044 amendment)",
  },
  {
    name: "pipeline.station_runs",
    isNamed: (line) => /pipeline\.station_runs/.test(line),
    hint: "holds only the runs Lore's own engine walked; a run on the external floor is read through floor-client",
  },
  {
    name: "Floor coordinator",
    isNamed: (line) => /floor coordinator/i.test(line),
    hint: "deleted with apps/floor; the external floor runs the lines",
  },
];

const BACKTICKED = /`([^`\n]+)`/g;
const PATH = /^[\w.@-]+(\/[\w.@[\]-]+)+\/?$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ADDS =
  /\b(add|adds|added|create|creates|new|ship|ships|implement|implements)\b|\bMUST be (defined|implemented|added|created|shipped)\b/i;
const FILES_TOUCHED = /files touched|project structure/i;
const HEADING = /^#{1,6}\s/;
/** A repository path written without backticks, as a plan quote loses them. */
const BARE_PATH =
  /(?<![\w/`])(?:apps|libs|specs|scripts|infra|adrs|charts|docs)\/[\w.@[\]/-]*\.[A-Za-z]{1,5}\b/g;

export function groundingFindings(input: GroundingInput): GroundingFinding[] {
  const lines = input.text.split("\n");
  const newPaths = addedPaths(
    [...declaredPaths(lines), ...(input.added ?? [])],
    input.tree,
  );

  return lines.flatMap((line, index) =>
    lineFindings({ ...input, newPaths }, line, index + 1),
  );
}

interface LineContext extends GroundingInput {
  /** The paths the plan says the feature adds, wherever it says so. */
  newPaths: ReadonlySet<string>;
}

/** A path counts as the feature's own new file when any line says it adds it, or a files-touched list names it; a file added in a folder main lacks adds that folder too. */
function addedPaths(
  declared: readonly string[],
  tree: readonly string[],
): Set<string> {
  const newFolders = declared
    .map(folderOf)
    .filter((folder) => folder !== "" && !onTree(tree, folder));

  return new Set([...declared, ...newFolders]);
}

/** The paths a text says the feature adds, for grounding the plan's other artifacts. */
export function declaredNewPaths(text: string): string[] {
  return declaredPaths(text.split("\n"));
}

function declaredPaths(lines: readonly string[]): string[] {
  const declared = new Set<string>();
  let inFilesTouched = false;

  for (const line of lines) {
    inFilesTouched = HEADING.test(line)
      ? FILES_TOUCHED.test(line)
      : inFilesTouched || FILES_TOUCHED.test(line);

    if (inFilesTouched || ADDS.test(line)) {
      pathsOn(line).forEach((path) => declared.add(path));
    }
  }

  return [...declared];
}

/** `a/b/c.ts` is in `a/b/`; a folder path is its own folder. */
function folderOf(path: string): string {
  return path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1);
}

function lineFindings(
  context: LineContext,
  line: string,
  lineNumber: number,
): GroundingFinding[] {
  const names = [...new Set(backticked(line))];
  const paths = pathsOn(line);
  const missing = missingPaths(context, paths);
  const namesNewFile = paths.some(
    (path) => isAdded(context.newPaths, path) && !onTree(context.tree, path),
  );
  const found: Omit<GroundingFinding, "line">[] = [
    ...retiredNamed(line),
    ...missing,
    ...(namesNewFile || ADDS.test(line)
      ? []
      : missingIdentifiers(names, filesNamed(context.files, paths))),
  ];

  return found.map((finding) => ({ ...finding, line: lineNumber }));
}

/** Every path a line names, in backticks or bare, anchors dropped. */
function pathsOn(line: string): string[] {
  const quoted = backticked(line)
    .map(withoutAnchor)
    .filter((name) => PATH.test(name));
  const bare = line.replace(BACKTICKED, " ").match(BARE_PATH) ?? [];

  return [...new Set([...quoted, ...bare])];
}

function retiredNamed(line: string): Omit<GroundingFinding, "line">[] {
  return RETIRED.filter((entry) => entry.isNamed(line)).map(
    ({ name, hint }) => ({
      name,
      kind: "retired",
      hint,
    }),
  );
}

function backticked(line: string): string[] {
  return [...line.matchAll(BACKTICKED)].map((match) => match[1].trim());
}

/** `path:38` and `path#L38` name the file `path`. */
function withoutAnchor(name: string): string {
  return name.replace(/(:\d+|#L\d+(-L?\d+)?)$/, "");
}

/** A retired path is reported as retired, and a path the feature adds is not missing. */
function missingPaths(
  { tree, newPaths }: LineContext,
  paths: readonly string[],
): Omit<GroundingFinding, "line">[] {
  return paths
    .filter(
      (path) =>
        !onTree(tree, path) &&
        !isAdded(newPaths, path) &&
        !RETIRED.some((entry) => entry.isNamed(`\`${path}\``)),
    )
    .map((name) => ({ name, kind: "path" }));
}

/** Added itself, or inside a folder the text adds. */
function isAdded(added: ReadonlySet<string>, path: string): boolean {
  return [...added].some(
    (entry) =>
      entry === path || (entry.endsWith("/") && path.startsWith(entry)),
  );
}

function onTree(tree: readonly string[], path: string): boolean {
  const folder = path.endsWith("/") ? path : `${path}/`;

  return tree.some((entry) => entry === path || entry.startsWith(folder));
}

function filesNamed(
  files: Readonly<Record<string, string>>,
  paths: readonly string[],
): string[] {
  return paths.flatMap((path) => (path in files ? [files[path]] : []));
}

/** A code-looking name is only checked against a file the same line names; with none named there is nothing to check it against. */
function missingIdentifiers(
  names: readonly string[],
  contents: readonly string[],
): Omit<GroundingFinding, "line">[] {
  if (contents.length === 0) {
    return [];
  }
  const words = new Set(
    contents.flatMap((content) => content.match(/[A-Za-z_$][\w$]*/g) ?? []),
  );

  return names
    .filter(
      (name) =>
        IDENTIFIER.test(name) && looksLikeCode(name) && !words.has(name),
    )
    .map((name) => withHint(name, [...words]));
}

function looksLikeCode(name: string): boolean {
  return /[a-z][A-Z]/.test(name) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(name);
}

function withHint(
  name: string,
  words: readonly string[],
): Omit<GroundingFinding, "line"> {
  const hint = closest(name, words);

  return hint
    ? { name, kind: "identifier", hint }
    : { name, kind: "identifier" };
}

/** The word sharing the most camel-case parts with the name; none when no part is shared. */
function closest(name: string, words: readonly string[]): string | undefined {
  const parts = new Set(camelParts(name));
  const scored = words
    .filter(looksLikeCode)
    .map((word) => ({
      word,
      shared: camelParts(word).filter((part) => parts.has(part)).length,
    }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared || a.word.length - b.word.length);

  return scored[0]?.word;
}

function camelParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean);
}

/** Every path the text names, in backticks or bare, anchors dropped: the files whose contents its identifiers are checked against. */
export function namedPaths(text: string): string[] {
  return [...new Set(text.split("\n").flatMap(pathsOn))];
}

export interface GroundedFile {
  path: string;
  findings: readonly GroundingFinding[];
}

/** The findings a writer is sent back with, one line each under the file they are in; empty when there are none. */
export function groundingBrief(files: readonly GroundedFile[]): string {
  const lines = files.flatMap(({ path, findings }) =>
    findings.map((finding) => `- \`${path}\`: ${findingLine(finding)}`),
  );

  if (lines.length === 0) {
    return "";
  }

  return [
    "## Not on main",
    "",
    "Rewrite each statement below from the code as it stands on main.",
    "",
    ...lines,
    "",
  ].join("\n");
}

function findingLine({ name, kind, line, hint }: GroundingFinding): string {
  const where = `\`${name}\` (line ${line})`;

  if (kind === "retired") {
    return `${where} is retired: ${hint}`;
  }

  if (kind === "path") {
    return `${where} is not on main`;
  }

  return hint
    ? `${where} is not in the files the line names; closest: \`${hint}\``
    : `${where} is not in the files the line names`;
}
