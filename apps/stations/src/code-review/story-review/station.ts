import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
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
  formalReview,
  reviewPasses,
  storyReview,
  type PassOutputs,
  type ReviewState,
} from "@re-cinq/lore-shared/review/story/story.js";

// How many passes must have answered when each node publishes; publish-incomplete shows whatever did.
const stages: Record<string, number> = {
  "publish-story": 1,
  finalize: reviewPasses.length,
  "publish-incomplete": reviewPasses.length,
};

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

export function startReviewProgressStation(
  name: "code-review-progress" | "finalize-code-review",
): RunningStation {
  return defineStation(name, reviewProgressHandle(productionDeps));
}

export function reviewProgressHandle(deps: ProgressDeps): Handle {
  return async (brief, tools) => {
    const [visit, outputs] = await Promise.all([
      readReviewVisit(deps, brief.visitId),
      readOutputs(brief.needs, tools),
    ]);

    const publication = publicationOf(visit, outputs);
    const { state, progress } = publication;

    if (state !== "failed" && progress.incomplete.length > 0) {
      return failedEvidence(progress.incomplete);
    }

    if (state === "complete") {
      await produceFormalReview(outputs, tools);
    }

    return reportProgress(deps, brief.needs, publication, tools.signal);
  };
}

function publicationOf(
  visit: ProgressVisit,
  outputs: PassOutputs,
): Publication {
  const stage = stageOf(visit.nodeId);

  return {
    visit,
    stage,
    state: progressState(visit.nodeId),
    progress: storyReview(outputs, stage),
  };
}

async function produceFormalReview(
  outputs: PassOutputs,
  tools: Tools,
): Promise<void> {
  const review = formalReview(outputs);

  enforceTrue(
    review,
    Error,
    "A formal verdict requires the story and both checks",
  );
  const json = JSON.stringify(review).replaceAll("`", "\\u0060");

  await tools.produce(
    "review_output",
    ["```REVIEW_FINDINGS", json, "```"].join("\n"),
  );
}

type Publication = {
  visit: ProgressVisit;
  stage: number;
  state: ReviewState;
  progress: ReturnType<typeof storyReview>;
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
      progress.comment(revision, state) +
      preparationNote(state, preparation_failed);

    await publishHosted(
      deps,
      target,
      { ...identityOf(visit), stage, body, headSha: revision },
      signal,
    );
  }

  return progressReport(visit, state);
}

// Posting retries share the run marker so GitHub receives the verdict only once.
function progressReport(visit: ProgressVisit, state: ReviewState): Report {
  return state === "complete"
    ? { outcome: "success", produced: { review_run: visit.runId } }
    : SUCCESS;
}

function preparationNote(state: ReviewState, failed: string): string {
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

async function readReviewVisit(
  deps: ProgressDeps,
  visitId: string,
): Promise<ProgressVisit> {
  const visit = await deps.visit(visitId);

  enforceTrue(
    visit &&
      ["code-review", "code-review-recheck"].includes(visit.lineId) &&
      Number.isFinite(visit.startedAt),
    Error,
    "Review progress requires a code review visit",
  );

  return visit;
}

function stageOf(nodeId: string): number {
  enforceTrue(nodeId in stages, Error, `Unknown review stage ${nodeId}`);

  return stages[nodeId];
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
    "Review progress requires a full commit SHA",
  );
  enforceTrue(
    visit.repo === floorRepoOf(target.repo),
    Error,
    "Review visit must belong to the pull request repository",
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

  enforceTrue(appLogin, Error, "Review publication requires Lore's GitHub App");

  await deps.serialize(repo, prNumber, () =>
    publishReviewProgress(project, { ...progress, prNumber, appLogin }, signal),
  );
}

function progressState(nodeId: string): ReviewState {
  switch (nodeId) {
    case "finalize":
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
): Promise<PassOutputs> {
  const outputs = await Promise.all(
    reviewPasses
      .filter((name) => needs[name])
      .map(
        async (name) =>
          [
            name,
            resultTextFromOutput((await tools.read(name)).toString("utf8")),
          ] as const,
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
      `code-review:${repo.toLowerCase()}#${prNumber}`,
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
