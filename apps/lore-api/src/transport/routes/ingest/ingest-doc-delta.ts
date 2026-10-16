import { selectPruneCandidates } from "@re-cinq/lore-shared";
import type { IngestDeltaDeps } from "./ingest-delta-deps.js";
import { mirrorQuietly } from "./mirror-quietly.js";

/** The part of a delta body a file kind (specs, adrs, code) reads. */
export interface DocDelta {
  kind: string;
  commit: string;
  files?: Array<{ path: string; content: string }>;
  deleted?: string[];
  present?: string[];
  force?: boolean;
}

/** Project a doc delta's files, then delete what it names as deleted and what a full ingest no longer names at all. */
export async function applyDocDelta(
  deps: IngestDeltaDeps,
  repo: string,
  delta: DocDelta,
): Promise<{ projected: number; deleted: number }> {
  const { project, remove, list } = docFunctions(deps, delta.kind);
  const projected = await projectFiles(project, repo, delta);
  const gone = [
    ...(delta.deleted ?? []),
    ...(await vanishedDocs(list, repo, delta)),
  ];

  await removeDocs(remove, repo, gone);
  await mirrorDelta(deps, repo, delta, gone);

  return { projected, deleted: gone.length };
}

const MIRRORED_KINDS: Partial<Record<string, "spec" | "adr">> = {
  specs: "spec",
  adrs: "adr",
};

/** After the graph has the delta, Utopia gets the same documents (see {@link mirrorQuietly}). */
async function mirrorDelta(
  deps: IngestDeltaDeps,
  repo: string,
  delta: DocDelta,
  gone: string[],
): Promise<void> {
  const kind = MIRRORED_KINDS[delta.kind];

  if (!kind) {
    return;
  }

  for (const file of delta.files ?? []) {
    await mirrorQuietly(repo, file.path, () =>
      deps.mirrorDoc(repo, { ...file, kind, commit: delta.commit }),
    );
  }

  for (const path of gone) {
    await mirrorQuietly(repo, path, () => deps.unmirrorDoc(repo, path));
  }
}

interface DocFunctions {
  project: IngestDeltaDeps["projectSpec"];
  remove: IngestDeltaDeps["deleteSpec"];
  list: IngestDeltaDeps["listSpecs"];
}

function docFunctions(deps: IngestDeltaDeps, kind: string): DocFunctions {
  const byKind: Record<string, DocFunctions> = {
    specs: {
      project: deps.projectSpec,
      remove: deps.deleteSpec,
      list: deps.listSpecs,
    },
    adrs: {
      project: deps.projectAdr,
      remove: deps.deleteAdr,
      list: deps.listAdrs,
    },
    code: {
      project: deps.projectCode,
      remove: deps.deleteCode,
      list: deps.listCode,
    },
  };

  return byKind[kind];
}

/** SEQUENTIAL on purpose: every projection upserts the shared Repo node, so concurrent ones abort each other's Dgraph transactions. */
async function projectFiles(
  project: IngestDeltaDeps["projectSpec"],
  repo: string,
  delta: DocDelta,
): Promise<number> {
  let projected = 0;

  for (const file of delta.files ?? []) {
    const outcome = await project(repo, file.path, file.content, {
      force: delta.force ?? false,
    });

    if (outcome.projected) {
      projected += 1;
    }
  }

  return projected;
}

/** The graph docs a full ingest no longer names. The shared fuse refuses a set that looks like a bad tree read (more than 2 docs AND more than half of what the graph holds) unless the delta is forced, and a refusal prunes nothing rather than failing an ingest whose files did land. */
async function vanishedDocs(
  list: IngestDeltaDeps["listSpecs"],
  repo: string,
  delta: DocDelta,
): Promise<string[]> {
  if (!delta.present?.length) {
    return [];
  }
  const selection = selectPruneCandidates(
    await list(repo),
    delta.present,
    () => true,
    delta.force ? "forced" : "guarded",
  );

  if (selection.outcome === "ok") {
    return selection.candidates;
  }
  console.warn(`[ingest-delta] ${delta.kind} ${repo}: ${refusalOf(selection)}`);

  return [];
}

function refusalOf(refused: {
  candidateCount: number;
  inScopeDocCount: number;
}): string {
  return `refusing to prune ${refused.candidateCount} of ${refused.inScopeDocCount} graph docs absent from the posted tree — re-run forced if they are really gone`;
}

/** One at a time, like the projections: every subtree delete rewrites the shared Repo node's edges. */
async function removeDocs(
  remove: IngestDeltaDeps["deleteSpec"],
  repo: string,
  paths: string[],
): Promise<void> {
  for (const path of paths) {
    await remove(repo, path);
  }
}
