/** Code projection (issue #1992): one CodeChunk per top-level definition of a TypeScript/JavaScript file, with a `CodeChunk.references` edge to every in-repo definition it calls. Content-hash gated per chunk, so re-projecting an unchanged file writes nothing. */

import { createHash } from "node:crypto";
import { extname, posix } from "node:path";
import type {
  DgraphClientPort,
  UidRef,
} from "../../outbound/spec-trace/deps.js";
import {
  replaceEdge,
  upsertByXid,
  withTxn,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import type { SourceDocument } from "./project-blocks.js";
import {
  readChunk,
  referencedUids,
  releaseChunk,
  releaseDropped,
} from "./code-chunk-release.js";
import type { ProjectionOptions } from "./project-spec-file.js";
import {
  extractCodeSymbols,
  type CodeSymbol,
  type ImportBinding,
} from "./reference-extractor.js";

/** The xid segment that marks a definition-keyed chunk, so it never collides with the line-keyed chunks a spec link mints for the same file. */
const CODE_SEGMENT = "code";

/** A larger file is generated, not written: parsing it costs lore-api memory and its definitions are nobody's callers. */
export const MAX_CODE_FILE_CHARS = 256_000;

interface PlannedChunk {
  xid: string;
  symbol: CodeSymbol;
  targets: TargetRef[];
  hash: string;
}

interface TargetRef {
  xid: string;
  symbol: string;
}

interface StoredChunk extends UidRef {
  "CodeChunk.xid": string;
  "CodeChunk.content_hash"?: string;
}

export async function projectCodeFile(
  doc: SourceDocument,
  dgraph: DgraphClientPort,
  options: ProjectionOptions = {},
): Promise<{ projected: boolean }> {
  if (doc.content.length > MAX_CODE_FILE_CHARS) {
    return { projected: false };
  }
  const planned = await planChunks(doc);
  const stored = await readFileChunks(dgraph, doc.repo, doc.filePath);

  if (!options.force && unchanged(planned, stored)) {
    return { projected: false };
  }
  await writeFileChunks(dgraph, doc, planned, stored);

  return { projected: true };
}

/** Removes every definition chunk of a file that left the tree. */
export async function deleteCodeFile(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<void> {
  for (const chunk of await readFileChunks(dgraph, repo, filePath)) {
    await releaseChunk(dgraph, chunk.uid);
  }
}

/** Every file path the graph holds definition chunks for, which a full ingest prunes against. */
export async function listCodeFilePaths(
  dgraph: DgraphClientPort,
  repo: string,
): Promise<string[]> {
  const prefix = `${repo}|${CODE_SEGMENT}|`;
  const chunks = await queryChunks(
    dgraph,
    `query q($repo: string) {
      chunks(func: eq(CodeChunk.repo, $repo)) @filter(has(CodeChunk.file_path)) {
        CodeChunk.xid
        CodeChunk.file_path
      }
    }`,
    { $repo: repo },
  );
  const definitions = chunks.filter((chunk) =>
    chunk["CodeChunk.xid"].startsWith(prefix),
  );

  return [...new Set(definitions.map((chunk) => chunk["CodeChunk.file_path"]))];
}

/** Every chunk the file should hold, each with the in-repo definitions it calls; calls to a package or an unknown name are dropped, since the graph is intra-repo. */
async function planChunks(doc: SourceDocument): Promise<PlannedChunk[]> {
  const { symbols, imports } = await extractCodeSymbols(
    extname(doc.filePath),
    doc.content,
  );
  const resolve = callResolver(doc, symbols, imports);
  const modulePath = modulePathOf(doc.filePath);

  return symbols.map((symbol) => {
    const targets = resolvedCalls(symbol, resolve);

    return {
      xid: codeChunkXid(doc.repo, modulePath, symbol.name),
      symbol,
      targets,
      hash: chunkHash(symbol, targets),
    };
  });
}

/** The definitions a symbol calls, recursion left out. */
function resolvedCalls(
  symbol: CodeSymbol,
  resolve: (call: string) => TargetRef | undefined,
): TargetRef[] {
  const others = symbol.calls.filter((call) => call !== symbol.name);

  return others.flatMap((call) => resolve(call) ?? []);
}

/** Text and outgoing keys together: an edited import changes what a chunk references without touching its text. */
function chunkHash(symbol: CodeSymbol, targets: TargetRef[]): string {
  const keys = targets.map((target) => target.xid).join("\n");

  return createHash("sha256")
    .update(symbol.text)
    .update("\0")
    .update(keys)
    .digest("hex");
}

/** Resolves a called name to the definition it binds: a sibling definition in this file, or a named import from a relative path. */
function callResolver(
  doc: SourceDocument,
  symbols: CodeSymbol[],
  imports: ImportBinding[],
): (call: string) => TargetRef | undefined {
  const local = new Set(symbols.map((symbol) => symbol.name));
  const byLocal = new Map(imports.map((binding) => [binding.local, binding]));
  const ownModule = modulePathOf(doc.filePath);

  return (call) => {
    if (local.has(call)) {
      return { xid: codeChunkXid(doc.repo, ownModule, call), symbol: call };
    }
    const binding = byLocal.get(call);

    return binding ? importedTarget(doc, binding) : undefined;
  };
}

/** A relative import names a module in this repo; a bare one names a package, which the graph does not hold. */
function importedTarget(
  doc: SourceDocument,
  binding: ImportBinding,
): TargetRef | undefined {
  if (!binding.fromPath.startsWith(".")) {
    return undefined;
  }
  const target = posix.normalize(
    posix.join(posix.dirname(doc.filePath), binding.fromPath),
  );

  return {
    xid: codeChunkXid(doc.repo, modulePathOf(target), binding.imported),
    symbol: binding.imported,
  };
}

/** A chunk xid names the module without its extension: `./transition.js` in an import and `transition.ts` on disk are the same module. */
function codeChunkXid(
  repo: string,
  modulePath: string,
  symbol: string,
): string {
  return `${repo}|${CODE_SEGMENT}|${modulePath}#${symbol}`;
}

function modulePathOf(filePath: string): string {
  return filePath.slice(0, filePath.length - extname(filePath).length);
}

function unchanged(planned: PlannedChunk[], stored: StoredChunk[]): boolean {
  const storedHashes = new Map(
    stored.map((s) => [s["CodeChunk.xid"], s["CodeChunk.content_hash"]]),
  );

  return (
    planned.length === stored.length &&
    planned.every((chunk) => storedHashes.get(chunk.xid) === chunk.hash)
  );
}

/** Writes every planned chunk, then releases the stored ones the file no longer defines. */
async function writeFileChunks(
  dgraph: DgraphClientPort,
  doc: SourceDocument,
  planned: PlannedChunk[],
  stored: StoredChunk[],
): Promise<void> {
  for (const chunk of planned) {
    await writeChunk(dgraph, doc, chunk);
  }
  const kept = new Set(planned.map((chunk) => chunk.xid));
  const gone = stored.filter((chunk) => !kept.has(chunk["CodeChunk.xid"]));

  for (const chunk of gone) {
    await releaseChunk(dgraph, chunk.uid);
  }
}

async function writeChunk(
  dgraph: DgraphClientPort,
  doc: SourceDocument,
  chunk: PlannedChunk,
): Promise<void> {
  const { symbol } = chunk;
  const uid = await upsertByXid(dgraph, "CodeChunk", chunk.xid, {
    "CodeChunk.repo": doc.repo,
    "CodeChunk.file_path": doc.filePath,
    "CodeChunk.symbol_name": symbol.name,
    "CodeChunk.start_line": symbol.startLine,
    "CodeChunk.end_line": symbol.endLine,
    "CodeChunk.content_hash": chunk.hash,
  });
  const previous = referencedUids(await readChunk(dgraph, uid));
  const targetUids = await upsertTargets(dgraph, doc.repo, chunk.targets);

  await replaceEdge(dgraph, uid, "CodeChunk.references", targetUids);
  await releaseDropped(dgraph, previous, targetUids);
}

/** A target projected later in the run binds to this same xid, so a placeholder carrying only its identity stands in until then. */
async function upsertTargets(
  dgraph: DgraphClientPort,
  repo: string,
  targets: TargetRef[],
): Promise<string[]> {
  const uids: string[] = [];

  for (const target of targets) {
    uids.push(
      await upsertByXid(dgraph, "CodeChunk", target.xid, {
        "CodeChunk.repo": repo,
        "CodeChunk.symbol_name": target.symbol,
      }),
    );
  }

  return uids;
}

/** The definition-keyed chunks the graph holds for one file; line-keyed spec-link chunks of the same file are not this projection's to touch. */
async function readFileChunks(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<StoredChunk[]> {
  const prefix = codeChunkXid(repo, modulePathOf(filePath), "");
  const chunks = await queryChunks(
    dgraph,
    `query q($repo: string, $fp: string) {
      chunks(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
        uid
        CodeChunk.xid
        CodeChunk.content_hash
      }
    }`,
    { $repo: repo, $fp: filePath },
  );

  return chunks.filter((chunk) => chunk["CodeChunk.xid"].startsWith(prefix));
}

type QueriedChunk = StoredChunk & { "CodeChunk.file_path": string };

async function queryChunks(
  dgraph: DgraphClientPort,
  query: string,
  vars: Record<string, string>,
): Promise<QueriedChunk[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(query, vars);

    return (res.data.chunks ?? []) as unknown as QueriedChunk[];
  });
}
