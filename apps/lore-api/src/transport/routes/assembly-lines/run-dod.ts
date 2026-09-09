import { z } from "zod";
import type { Request, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  dodProgress,
  matchAcceptanceTests,
  parseDodMarkdown,
  type DefinitionOfDone,
  type TestReportRow,
  type TestReportsRepository,
} from "@re-cinq/lore-shared";
import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { PgTestReports } from "@re-cinq/lore-shared/project/test-reports/test-reports-pg.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

// GET /api/assembly-runs/{id}/dod — the run's Definition of Done (`.lore/dod.md` on its branch) with each acceptance test matched against the branch's latest CI report (specs/implementation-loop FR16). A terminal run answers "not present" without a GitHub read: pr-ready removes the file, and a finished branch has nothing left to show.

export const DOD_PATH = ".lore/dod.md";

const AcceptanceTestStatusSchema = z.object({
  path: z.string(),
  name: z.string(),
  behaviour: z.string(),
  status: z.enum(["pass", "fail", "unknown"]),
  matchedId: z.string().nullable(),
});

const DodProgressSchema = z.object({
  present: z.boolean(),
  ticketClaim: z.string().optional(),
  strategy: z.string().optional(),
  why: z.string().optional(),
  acceptanceTests: z.array(AcceptanceTestStatusSchema).optional(),
  facets: z.array(z.object({ text: z.string(), done: z.boolean() })).optional(),
  outOfScope: z.array(z.string()).optional(),
  passed: z.number().optional(),
  total: z.number().optional(),
  report: z
    .object({ commit: z.string(), branch: z.string(), receivedAt: z.string() })
    .nullable()
    .optional(),
});

type DodProgress = z.infer<typeof DodProgressSchema>;

export type ReadRepoFile = (
  repo: string,
  path: string,
  ref: string,
) => Promise<string | null>;

export interface RunDodDeps {
  runs?: AssemblyRunsPort;
  testReports?: TestReportsRepository;
  readFile?: ReadRepoFile;
}

const ABSENT: DodProgress = { present: false };

/** A file on a branch through the project facade; 424 rather than 500 when GitHub is unconfigured — nothing failed, the dependency is absent. */
async function readThroughProject(
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const project = await projectFor(repo);

  enforceTrue(
    project.repo.isConfigured(),
    apiError(424),
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN.",
  );

  return project.repo.read(path, ref);
}

/** The injected ports, or ones built on the pool; refusing with 503 when neither is possible. */
function resolveDeps(
  pool: Pool | null,
  deps: RunDodDeps,
): Required<RunDodDeps> {
  enforceTrue(
    (deps.runs !== undefined && deps.testReports !== undefined) ||
      pool !== null,
    apiError(503),
    "database unavailable",
  );

  return {
    runs: deps.runs ?? new PgAssemblyRuns(pool as Pool),
    testReports: deps.testReports ?? new PgTestReports(pool as Pool),
    readFile: deps.readFile ?? readThroughProject,
  };
}

/** The branch a live run's definition of done lives on; a finished or failed run has nothing left to show, so it costs no GitHub read. */
function openBranch(run: AssemblyRunRecord): string | null {
  return run.status === "finished" || run.status === "failed"
    ? null
    : run.branch;
}

function progress(
  dod: DefinitionOfDone | null,
  report: TestReportRow | null,
): DodProgress {
  if (!dod) {
    return ABSENT;
  }
  const acceptanceTests = matchAcceptanceTests(dod, report);

  return {
    present: true,
    ...dod,
    acceptanceTests,
    ...dodProgress(acceptanceTests),
    report: report && {
      commit: report.commit,
      branch: report.branch,
      receivedAt: report.receivedAt.toISOString(),
    },
  };
}

async function serveRunDod(
  getPool: () => Pool | null,
  injected: RunDodDeps,
  request: Request,
): Promise<DodProgress> {
  const deps = resolveDeps(getPool(), injected);
  const run = await deps.runs.getById(request.params.id);

  enforceTrue(run !== null, apiError(404), "assembly run not found");
  const branch = openBranch(run);

  if (branch === null) {
    return ABSENT;
  }
  const [text, report] = await Promise.all([
    deps.readFile(run.repo, DOD_PATH, branch),
    deps.testReports.latestForBranch(run.repo, branch),
  ]);

  return progress(parseDodMarkdown(text ?? ""), report);
}

export function runDodRoute(
  getPool: () => Pool | null,
  deps: RunDodDeps = {},
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/dod",
    options: zodResponse(bearerScope("read"), DodProgressSchema, {
      name: "DodProgress",
      description:
        "The run's Definition of Done with each acceptance test matched against the branch's latest CI report",
      errors: [404],
    }),
    handler: (request) => serveRunDod(getPool, deps, request),
  };
}
