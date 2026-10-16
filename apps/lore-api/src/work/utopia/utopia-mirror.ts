// The ingest-side door to the Utopia mirror: a repo whose settings name a Utopia source whose key lore.utopia_sources holds, on a deployment given a Utopia, has every spec, ADR and default-branch test run it ingests pushed there; on a deployment holding a Utopia write token, a repo not set up yet is set up first.

import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { LORE_ONTOLOGY_VERSION } from "@re-cinq/lore-shared/lore-ontology.js";
import {
  UtopiaMirrorSettingsSchema,
  type UtopiaMirrorSettings,
} from "@re-cinq/lore-shared/models/repo-settings.js";
import { recordUtopiaMirrorFailure } from "@re-cinq/lore-shared/otel/metrics.js";
import {
  utopiaAutoSetupConfigured,
  utopiaClient,
  utopiaConfigured,
  type UtopiaEnv,
  type UtopiaSource,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import {
  mirrorDocument,
  tombstoneDocument,
  type MirrorDeps,
  type MirrorOutcome,
} from "@re-cinq/lore-shared/utopia/mirror-document.js";
import {
  mirrorTestReport,
  tombstoneTestFiles,
} from "@re-cinq/lore-shared/utopia/mirror-test-report.js";
import type { TestReportInput } from "@re-cinq/lore-shared/utopia/test-report-statements.js";
import { getPool } from "@re-cinq/lore-server-core/platform/db.js";
import type { Pool } from "pg";
import { projectFor } from "../../outbound/project-boot.js";
import {
  utopiaSourceFor,
  type StoredUtopiaSource,
} from "../../outbound/utopia-sources.js";
import { autoSetUpRepo, autoUpgradeOntology } from "./utopia-auto-setup.js";

export interface MirroredDoc {
  path: string;
  content: string;
  kind: "spec" | "adr";
  commit: string;
}

/** A test report as the delta route received it, and the commit the delta names. */
export interface MirroredReport {
  report: unknown;
  commit: string;
}

/** The source the repo's documents are pushed to, or null when the deployment has no Utopia, the repo was never set up there, or the stored key belongs to another source than the one its settings name. */
export function mirrorSource(
  settings: Record<string, unknown> | null,
  stored: StoredUtopiaSource | null,
  env: UtopiaEnv = process.env,
): UtopiaSource | null {
  const named = namedSourceId(settings);

  if (!utopiaConfigured(env) || !stored || stored.id !== named) {
    return null;
  }

  return { id: stored.id, key: stored.key };
}

function namedSourceId(
  settings: Record<string, unknown> | null,
): string | null {
  const parsed = UtopiaMirrorSettingsSchema.safeParse(settings?.utopia);

  return parsed.success ? parsed.data.source_id : null;
}

export async function mirrorDocFor(
  repo: string,
  doc: MirroredDoc,
): Promise<void> {
  const deps = await mirrorDepsFor(repo);

  if (deps) {
    settled(await mirrorDocument(deps, { repo, ...doc }));
  }
}

export async function unmirrorDocFor(
  repo: string,
  path: string,
): Promise<void> {
  const deps = await mirrorDepsFor(repo);

  if (deps) {
    settled(await tombstoneDocument(deps, { repo, path }));
  }
}

export async function mirrorReportFor(
  repo: string,
  { report, commit }: MirroredReport,
): Promise<void> {
  const run = { repo, commit, ...reportRuns(report) };
  const deps = run.tests.length > 0 ? await mirrorDepsFor(repo) : null;

  if (deps) {
    settled(await mirrorTestReport(deps, run));
  }
}

export async function unmirrorTestFilesFor(
  repo: string,
  paths: string[],
): Promise<void> {
  const deps = await mirrorDepsFor(repo);

  if (deps) {
    settled(await tombstoneTestFiles(deps, paths));
  }
}

/** The descriptors and results of a report the route took as unknown; a report missing either list mirrors without it. */
function reportRuns(
  report: unknown,
): Pick<TestReportInput, "tests" | "results"> {
  const { tests, results } = (report ?? {}) as Record<string, unknown>;

  return {
    tests: Array.isArray(tests) ? tests : [],
    results: Array.isArray(results) ? results : [],
  };
}

function mirrorDepsFor(repo: string): Promise<MirrorDeps | null> {
  return utopiaConfigured()
    ? repoMirrorDeps(getPool(), repo)
    : Promise.resolve(null);
}

/** Pushes to the repo's source, or null when it has none to mirror to (see {@link sourceToMirror}). */
export async function repoMirrorDeps(
  pool: Pool,
  repo: string,
): Promise<MirrorDeps | null> {
  const { settings } = await projectFor(repo);
  const source = await sourceToMirror(pool, repo, await settings.rawSettings());

  return (
    source && {
      push: (pushed) => utopiaClient().pushStatements(source, pushed),
    }
  );
}

/** The source the repo was set up with, its ontology upgraded first where the base holds an older one, else a fresh setup where the deployment may run one itself, else null. A failed setup throws, so the ingest logs and counts it as a failed mirror. */
export async function sourceToMirror(
  pool: Pool,
  repo: string,
  settings: Record<string, unknown> | null,
  env: UtopiaEnv = process.env,
): Promise<UtopiaSource | null> {
  const stored = await utopiaSourceFor(pool, repo);
  const source = mirrorSource(settings, stored, env);

  if (source) {
    await upgradeOntologyQuietly(pool, repo, settings?.utopia, env);

    return source;
  }

  return utopiaAutoSetupConfigured(env)
    ? autoSetUpRepo(pool, repo, stored, env)
    : null;
}

/** Without a write token the push goes ahead on the old ontology, its new attributes landing unbound; a failed upgrade is logged and counted as a failed mirror, and the push goes ahead all the same. */
async function upgradeOntologyQuietly(
  pool: Pool,
  repo: string,
  utopia: unknown,
  env: UtopiaEnv,
): Promise<void> {
  const mirror = UtopiaMirrorSettingsSchema.parse(utopia);

  if (ontologyUpgradable(mirror, env)) {
    await autoUpgradeOntology(pool, repo, mirror, env).catch(
      (error: unknown) => {
        console.error(
          `[utopia-mirror] ${repo} ontology upgrade: ${errorMessage(error)}`,
        );
        recordUtopiaMirrorFailure(repo);
      },
    );
  }
}

function ontologyUpgradable(
  mirror: UtopiaMirrorSettings,
  env: UtopiaEnv,
): boolean {
  return (
    (mirror.ontology_version ?? 0) < LORE_ONTOLOGY_VERSION &&
    utopiaAutoSetupConfigured(env)
  );
}

/** One failed item fails the document, so the ingest logs and counts it. */
function settled(outcome: MirrorOutcome): void {
  const failure = mirrorFailure(outcome);

  enforceTrue(failure === null, Error, failure ?? "");
}

/** Why a document did not land whole, named by its first failed item; null when every item landed. */
export function mirrorFailure(outcome: MirrorOutcome): string | null {
  const { failed } = outcome;

  return failed.length === 0
    ? null
    : `${failed.length} of ${outcome.items} items failed: ${failed[0]}`;
}
