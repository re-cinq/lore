import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import type { Pool } from "pg";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  parsePullRequestUrl,
  type PullRequestLocation,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import {
  publishReviewProgress,
  type ReviewProgressProject,
  type ReviewProgress,
} from "@re-cinq/lore-shared/review/review-progress.js";
import { projectFor } from "../../outbound/project-boot.js";
import {
  progressNeeds,
  reviewProgress,
  type ProgressResults,
  type ProgressState,
} from "./render.js";

const stages = [
  "publish-code",
  "publish-tests",
  "publish-intent",
  "publish-challenge",
  "publish-product",
  "publish-incomplete",
];

const SUCCESS: Report = { outcome: "success" };

type ProgressVisit = {
  nodeId: string;
  runId: string;
  lineId: string;
  repo: string | null;
  startedAt: number;
};

interface ProgressDeps {
  appLogin(): Promise<string | undefined>;
  visit(visitId: string): Promise<ProgressVisit | undefined>;
  project(repo: string): Promise<ReviewProgressProject>;
  serialize(
    repo: string,
    prNumber: number,
    publish: () => Promise<void>,
  ): Promise<void>;
}

export function startShadowReviewProgressStation(): RunningStation {
  return defineStation(
    "shadow-review-progress",
    shadowReviewProgressHandle(productionDeps),
  );
}

export function shadowReviewProgressHandle(deps: ProgressDeps): Handle {
  return async (brief, tools) => {
    const [visit, outputs] = await Promise.all([
      readShadowVisit(deps, brief.visitId),
      readOutputs(brief.needs, tools),
    ]);

    const stage = stageOf(visit.nodeId);
    const state = progressState(visit.nodeId);
    const progress = reviewProgress(outputs, stage);

    if (state !== "failed" && progress.incomplete.length > 0) {
      return failedEvidence(progress.incomplete);
    }

    return reportProgress(
      deps,
      brief.needs,
      { visit, stage, state, progress },
      tools.signal,
    );
  };
}

type Publication = {
  visit: ProgressVisit;
  stage: number;
  state: ProgressState;
  progress: ReturnType<typeof reviewProgress>;
};

async function reportProgress(
  deps: ProgressDeps,
  { pr_url: url, revision, preparation_failed }: Record<string, string>,
  { visit, stage, state, progress }: Publication,
  signal: AbortSignal,
): Promise<Report> {
  if (url) {
    const target = hostedTarget(url, revision, visit);
    const body =
      progress.body(revision, state) +
      preparationNote(state, preparation_failed);

    await publishHosted(
      deps,
      target,
      { ...identityOf(visit), stage, body, headSha: revision },
      signal,
    );
  }

  return SUCCESS;
}

function preparationNote(state: ProgressState, failed: string): string {
  return state === "failed" && failed === "true"
    ? "\n\nLore could not prepare the evidence for this revision."
    : "";
}

function identityOf({ runId, startedAt }: ProgressVisit) {
  return { runId, startedAt };
}

function failedEvidence(passes: string[]): Report {
  return {
    outcome: "failed",
    error: `Incomplete review evidence: ${passes.join(", ")}`,
  };
}

async function readShadowVisit(
  deps: ProgressDeps,
  visitId: string,
): Promise<ProgressVisit> {
  const visit = await deps.visit(visitId);

  enforceTrue(
    visit?.lineId === "code-review-shadow" && Number.isFinite(visit.startedAt),
    Error,
    "Shadow review progress requires a shadow review visit",
  );

  return visit;
}

function stageOf(nodeId: string): number {
  const stage = stages.indexOf(nodeId);

  enforceTrue(stage >= 0, Error, `Unknown shadow review stage ${nodeId}`);

  return stage;
}

function hostedTarget(
  url: string,
  revision: string,
  visit: ProgressVisit,
): PullRequestLocation {
  const target = parsePullRequestUrl(url);

  enforceTrue(
    /^[a-f0-9]{40}$/.test(revision),
    Error,
    "Shadow review requires a full commit SHA",
  );
  enforceTrue(
    visit.repo === floorRepoOf(target.repo),
    Error,
    "Shadow review visit must belong to the pull request repository",
  );

  return target;
}

async function publishHosted(
  deps: ProgressDeps,
  { repo, prNumber }: PullRequestLocation,
  progress: Omit<ReviewProgress, "appLogin" | "prNumber">,
  signal: AbortSignal,
): Promise<void> {
  const [project, appLogin] = await Promise.all([
    deps.project(repo),
    deps.appLogin(),
  ]);

  enforceTrue(
    appLogin,
    Error,
    "Shadow review publication requires Lore's GitHub App",
  );

  await deps.serialize(repo, prNumber, () =>
    publishReviewProgress(project, { ...progress, prNumber, appLogin }, signal),
  );
}

function progressState(nodeId: string): ProgressState {
  switch (nodeId) {
    case "publish-product":
      return "complete";
    case "publish-incomplete":
      return "failed";
    default:
      return "running";
  }
}

async function readOutputs(
  needs: Record<string, string>,
  tools: Tools,
): Promise<ProgressResults> {
  const outputs = await Promise.all(
    progressNeeds
      .filter((name) => needs[name])
      .map(
        async (name) =>
          [name, (await tools.read(name)).toString("utf8")] as const,
      ),
  );

  return Object.fromEntries(outputs);
}

const productionDeps: ProgressDeps = {
  appLogin: loreAppLogin,
  visit: progressVisit,
  project: projectFor,
  serialize: (repo, prNumber, publish) =>
    withProgressLock(
      getPool(),
      `shadow-review:${repo.toLowerCase()}#${prNumber}`,
      publish,
    ),
};

async function progressVisit(
  visitId: string,
): Promise<ProgressVisit | undefined> {
  const floor = floorClient();
  const visit = await floor.stationRuns.get(visitId);
  const run = visit && (await floor.runs.get(visit.runId))?.run;

  if (visit && run) {
    return {
      nodeId: visit.nodeId,
      runId: run.id,
      lineId: run.lineId,
      repo: run.repo,
      startedAt: Date.parse(run.createdAt),
    };
  }
}

async function withProgressLock(
  pool: Pool,
  key: string,
  publish: () => Promise<void>,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [key],
    );
    await publish();
  } finally {
    // The transaction only holds the cross-worker lock. Discard the connection if release fails.
    await client.query("ROLLBACK").then(
      () => client.release(),
      () => client.release(new Error("Could not release shadow review lock")),
    );
  }
}
