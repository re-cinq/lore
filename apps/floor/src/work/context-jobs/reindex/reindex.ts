import {
  healStaleChunkerFiles,
  backfillUningestedFiles,
  type IndexedRepo,
} from "./reindex-sweeps.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { chunks, settings } from "../../../outbound/queues.js";
import { writeAuditLog } from "../../../outbound/audit.js";
import { classifyFile } from "@re-cinq/lore-shared";
import { verifyRepoChunks } from "./verify.js";
import {
  adoptLegacyOrgSharedChunks,
  getChangedFiles,
  getTree,
  ingestFile,
  ingestRepoFiles,
  resolveSchema,
} from "./reindex-ingest.js";

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

/** Root-level files and directory prefixes seeded for repos with no prior ingestion. */
const SEED_EXACT = new Set(["CLAUDE.md", "AGENTS.md"]);
const SEED_PREFIXES = ["adrs/", "specs/", ".specify/"];

/** Audit rows cap the recorded pruned-path list to prevent megabyte payloads. */
const AUDIT_PRUNED_PATHS_CAP = 500;

/** Per-repo, per-run cap on chunker-upgrade heal sweep to spread re-embed across nights. */

/** Per-repo, per-run cap on never-ingested backfill sweep (mirrors HEAL_FILES_PER_RUN). */
export const BACKFILL_FILES_PER_RUN = 200;

/** Filters repo tree to seed set: supported types under seed roots (unit-tested in reindex-seed.test.ts). */
export function selectSeedFiles(treePaths: string[]): string[] {
  return treePaths.filter(
    (path) =>
      classifyFile(path) !== null &&
      (SEED_EXACT.has(path) ||
        SEED_PREFIXES.some((prefix) => path.startsWith(prefix))),
  );
}

// ── Chunker-upgrade heal sweep ──────────────────────────────────────

/** Re-ingest code files pre-dating CHUNKER_VERSION; delete chunks for reclassified files. */

// ── Never-ingested backfill sweep ───────────────────────────────────

// ── Main job ─────────────────────────────────────────────────────────

/** Resolves the repo's schema and relocates legacy org_shared rows into it before chunk count; null when the schema is unusable. */
async function resolvedTargetSchema(fullName: string): Promise<string | null> {
  const schema = await resolveSchema(fullName);

  if (!SCHEMA_RE.test(schema)) {
    console.error(`[job] Invalid schema "${schema}" for ${fullName}, skipping`);

    return null;
  }

  // Relocate legacy org_shared rows into the resolved schema before chunk count.
  if (schema !== "org_shared") {
    await adoptLegacyOrgSharedChunks(schema, fullName);
  }

  return schema;
}

interface FileSelection {
  treePaths: string[] | null;
  filePaths: string[];
}

async function selectFilesToIngest(
  fullName: string,
  lastIngestedAt: Date | null,
): Promise<FileSelection> {
  const treePaths = lastIngestedAt ? null : await getTree(fullName);
  const filePaths = lastIngestedAt
    ? await getChangedFiles(fullName, lastIngestedAt)
    : selectSeedFiles(treePaths ?? []);

  return { treePaths, filePaths };
}

async function ingestChangedFiles(
  filePaths: string[],
  fullName: string,
  schema: string,
): Promise<number> {
  if (filePaths.length === 0) {
    console.log(`[job] No files to reindex for ${fullName}`);

    return 0;
  }

  console.log(`[job] Processing ${filePaths.length} files for ${fullName}`);

  return ingestRepoFiles(filePaths, fullName, schema);
}

/** The three passes that run after the incremental one, in the order their failures matter: heal re-ingests files chunked by an older chunker (#995), verification prunes chunks whose file is gone, and backfill picks up files never ingested at all (#999). The tree is fetched at most ONCE across them and only if a pass actually needs it. */
async function runSweeps(
  target: IndexedRepo,
  pass: {
    treePaths: string[] | null;
    processed: Set<string>;
    ingest: (filePath: string) => Promise<boolean>;
  },
): Promise<number> {
  const { repo } = target;
  const { processed, ingest } = pass;
  // Fetched at most once, and only if a pass actually needs it — the tree is a full repo listing.
  const memo: { paths: string[] | null } = { paths: pass.treePaths };
  const tree = async (): Promise<string[]> =>
    (memo.paths ??= await getTree(repo));

  let healed = await sweep(repo, "Chunker heal sweep", () =>
    healStaleChunkerFiles(chunks(), target, processed, ingest),
  );

  await sweep(repo, "Verification pass", async () =>
    verifyChunks(target, await tree()),
  );
  healed += await sweep(repo, "Backfill sweep", async () =>
    backfillUningestedFiles(
      chunks(),
      target,
      { treePaths: await tree(), alreadyProcessed: processed },
      ingest,
    ),
  );

  return healed;
}

/** One repo's reindex, or null when it has no usable schema. Every sweep below is independently fail-soft: a repo keeps whatever the earlier passes ingested. */
async function reindexRepo(repo: {
  full_name: string;
  last_ingested_at: Date | null;
}): Promise<number | null> {
  const schema = await resolvedTargetSchema(repo.full_name);

  if (!schema) {
    return null;
  }
  // Zero chunks means the first ingestion failed, so the incremental window is meaningless — seed the whole repo instead.
  const hasChunks = (await chunks().countChunks(schema, repo.full_name)) > 0;
  const lastIngestedAt = hasChunks ? repo.last_ingested_at : null;
  const selection = await selectFilesToIngest(repo.full_name, lastIngestedAt);
  const treePaths = selection.treePaths;
  const filePaths = selection.filePaths;
  const ingest = (filePath: string) =>
    ingestFile(filePath, repo.full_name, schema);
  let fileCount = await ingestChangedFiles(filePaths, repo.full_name, schema);
  const processed = new Set(filePaths);

  const target = { schema, repo: repo.full_name };

  fileCount += await runSweeps(target, { treePaths, processed, ingest });
  await settings().markIngested(repo.full_name);

  return fileCount;
}

/** One optional pass. A sweep that throws costs its own contribution and nothing else — the repo keeps what the passes before it ingested. */
export async function sweep(
  repo: string,
  name: string,
  run: () => Promise<number | void>,
): Promise<number> {
  try {
    return (await run()) ?? 0;
  } catch (err) {
    console.error(`[job] ${name} failed for ${repo}: ${errorMessage(err)}`);

    return 0;
  }
}

/** Records what a prune removed. The path list is CAPPED and says so: a repo-wide prune can delete thousands of files, and an audit row nobody can load is worse than a truncated one. */
async function auditPrune(
  target: { schema: string; repo: string },
  pruned: number,
  prunedFiles: string[],
): Promise<void> {
  await writeAuditLog({
    event_type: "reindex_prune",
    repo: target.repo,
    payload: {
      schema: target.schema,
      pruned_rows: pruned,
      file_count: prunedFiles.length,
      file_paths: prunedFiles.slice(0, AUDIT_PRUNED_PATHS_CAP),
      truncated: prunedFiles.length > AUDIT_PRUNED_PATHS_CAP,
    },
  }).catch((err) =>
    console.error(
      `[job] reindex_prune audit failed for ${target.repo}: ${errorMessage(err)}`,
    ),
  );
}

/** Re-stamp what is still there and prune what is not, recording a pruned sweep in the audit log. */
async function verifyChunks(
  target: { schema: string; repo: string },
  treePaths: string[],
): Promise<void> {
  const { touched, pruned, prunedFiles } = await verifyRepoChunks(
    chunks(),
    target.schema,
    target.repo,
    treePaths,
  );

  console.log(
    `[job] Verified ${target.repo}: ${touched} chunks re-stamped, ${pruned} orphaned chunks pruned`,
  );

  if (pruned > 0) {
    await auditPrune(target, pruned, prunedFiles);
  }
}

function lastIngestedLabel(date: Date | null): string {
  return date?.toISOString() ?? "never";
}

/** One repo's pass, with its failure contained: a repo whose GitHub read or schema lookup fails must not stop the nightly job for every repo behind it. Null means nothing was indexed — no schema, or a failure. */
async function reindexOneRepo(
  repo: Parameters<typeof reindexRepo>[0],
): Promise<number | null> {
  console.log(
    `[job] Reindexing ${repo.full_name} (last ingested: ${lastIngestedLabel(repo.last_ingested_at)})`,
  );

  try {
    const fileCount = await reindexRepo(repo);

    if (fileCount !== null) {
      console.log(
        `[job] Finished ${repo.full_name}: ${fileCount} files reindexed`,
      );
    }

    return fileCount;
  } catch (err) {
    console.error(
      `[job] Error reindexing ${repo.full_name}: ${errorMessage(err)}`,
    );

    return null;
  }
}

export async function reindexJob(): Promise<string> {
  const repos = await settings().onboardedRepos();

  if (repos.length === 0) {
    console.log("[job] No onboarded repos to reindex");

    return "No onboarded repos to reindex";
  }

  let totalFiles = 0;
  let totalRepos = 0;

  for (const repo of repos) {
    const fileCount = await reindexOneRepo(repo);

    if (fileCount !== null) {
      totalFiles += fileCount;
      totalRepos++;
    }
  }
  const summary = `Reindexed ${totalFiles} files across ${totalRepos} repos`;

  console.log(`[job] ${summary}`);

  return summary;
}
