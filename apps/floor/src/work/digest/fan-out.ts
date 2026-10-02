// Layer-3 handler for `cron.daily_digest.tick` (specs/daily-digest FR2/FR8): starts ONE run per Slack channel that is due, on the Postgres-walked line. Where the external floor is configured it walks the digest instead (the stations service starts it), so this handler stands down.

import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  digestRunArgs,
  dueChannelRuns,
  type ChannelRun,
  type DueDeps,
} from "@re-cinq/lore-shared/digest/due-channel-runs.js";
import {
  DAILY_DIGEST_LINE,
  MAX_RUNS_PER_CHANNEL_DAY,
} from "@re-cinq/lore-shared/digest/contract.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import type { EventHandler } from "../../domain/event-types.js";
import { pipeline, settings } from "../../outbound/queues.js";
import { projectFor } from "../../outbound/project-boot.js";
import { startUnderJobRun } from "../fan-out/start-under-job-run.js";

export interface DigestFanOutDeps extends DueDeps {
  assemblyRuns: Pick<
    AssemblyRunsPort,
    "start" | "getById" | "findOpenBySubject" | "countBySubject"
  >;
  jobRuns: {
    start(jobName: string): Promise<string>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
  defaultBranch(repo: string): Promise<string>;
}

export function createDailyDigestTickHandler(
  deps: DigestFanOutDeps,
): EventHandler {
  return async (params) => {
    for (const run of await dueChannelRuns(params, deps)) {
      await startChannelRun(run, deps).catch((err: Error) =>
        console.error(`[digest] ${run.channel}: ${err.message}`),
      );
    }
  };
}

/** One run per channel per scheduled slot of a local day, keyed so a second tick joins rather than duplicates, and capped so a run that never reports does not respawn all day. Everything that can fail is read before the job_run is minted, so a failure orphans nothing. */
async function startChannelRun(
  run: ChannelRun,
  deps: DigestFanOutDeps,
): Promise<void> {
  if (await skipChannel(run, deps)) {
    return;
  }
  const input = await startInput(run, deps);
  const jobRunId = await deps.jobRuns.start(`daily_digest:${run.channel}`);
  const { id, joined } = await startUnderJobRun(
    `[digest] ${run.channel}`,
    input,
    jobRunId,
    deps,
  );

  if (!joined) {
    console.log(`[digest] ${run.channel}: started run ${id}`);
  }
}

async function skipChannel(
  { host, subjectKey }: ChannelRun,
  deps: DigestFanOutDeps,
): Promise<boolean> {
  const [inFlight, attempts] = await Promise.all([
    deps.assemblyRuns.findOpenBySubject(host.repo, subjectKey),
    deps.assemblyRuns.countBySubject(host.repo, subjectKey),
  ]);
  const reason = skipReason(inFlight?.id, attempts);

  if (reason) {
    console.log(`[digest] ${subjectKey} ${reason}, skipping`);
  }

  return reason !== null;
}

function skipReason(
  inFlightId: string | undefined,
  attempts: number,
): string | null {
  if (inFlightId) {
    return `already running as ${inFlightId}`;
  }

  return attempts >= MAX_RUNS_PER_CHANNEL_DAY
    ? `started ${attempts} times today`
    : null;
}

/** `ref` is the host repo's default branch: an agent node clones `args.ref`, and the run's own branch name is only the lease key. */
async function startInput(run: ChannelRun, deps: DigestFanOutDeps) {
  return {
    blueprintName: DAILY_DIGEST_LINE,
    repo: run.host.repo,
    branch: `digest/${run.channel}`,
    subjectKey: run.subjectKey,
    args: {
      ...digestRunArgs(run, deps.now()),
      ref: await deps.defaultBranch(run.host.repo),
    },
  };
}

/** One engine posts a channel's digest, never both: with a floor configured the stations service starts the run there, and this handler stands down. */
export const dailyDigestTick: EventHandler = async (params) => {
  if (floorConfigured()) {
    return;
  }
  await createDailyDigestTickHandler({
    repoSettings: () => settings().onboardedRepoSettings(),
    posts: pipeline().digestPosts,
    assemblyRuns: pipeline().assemblyRuns,
    jobRuns: pipeline().jobRuns,
    defaultBranch: async (repo) =>
      (await projectFor(repo)).repo.defaultBranch(),
    now: () => new Date(),
  })(params);
};
