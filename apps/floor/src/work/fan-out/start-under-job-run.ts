// Starting one subject-keyed run under a pre-minted job_run, shared by every tick that fans out (detect per repo, daily digest per channel): the two ways a start can go wrong both orphan the job_run, and nothing reaps those.

import type {
  AssemblyRunsPort,
  AssemblyRunStartInput,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

export interface StartUnderJobRunDeps {
  assemblyRuns: Pick<AssemblyRunsPort, "start" | "getById">;
  jobRuns: { fail(runId: string, reason: string): Promise<unknown> };
}

export interface StartedUnderJobRun {
  id: string;
  /** True when another tick's run already held the subject: its run is `id`, and this tick's job_run was closed as superseded. */
  joined: boolean;
}

/** Starts (or joins) the run; never throws for a "superseded" join, only for a genuine `assembly_line.start` failure. */
export async function startUnderJobRun(
  label: string,
  input: AssemblyRunStartInput,
  jobRunId: string,
  deps: StartUnderJobRunDeps,
): Promise<StartedUnderJobRun> {
  const id = await startOrFailJobRun(
    { ...input, args: { ...input.args, job_run_id: jobRunId } },
    jobRunId,
    deps,
  );
  const joined = await joinedAnotherTick(label, id, jobRunId, deps);

  return { id, joined };
}

/** A throw mid-loop would ORPHAN the job_run — nothing reaps those — so it is failed before the error is rethrown, and the retry settles cleanly. */
async function startOrFailJobRun(
  input: AssemblyRunStartInput,
  jobRunId: string,
  deps: StartUnderJobRunDeps,
): Promise<string> {
  const { assemblyRuns, jobRuns } = deps;

  try {
    return await assemblyRuns.start(input);
  } catch (err) {
    await jobRuns
      .fail(jobRunId, `assembly_line.start failed: ${(err as Error).message}`)
      .catch(() => {});
    throw err;
  }
}

/** Two ticks can both read "nothing in flight" — the loser's start() then JOINS the winner's run rather than creating a second one, and a job_run_id that is not ours is exactly that join. Its job_run is closed here, because otherwise it stays open forever with no run behind it. */
async function joinedAnotherTick(
  label: string,
  id: string,
  jobRunId: string,
  deps: StartUnderJobRunDeps,
): Promise<boolean> {
  const { assemblyRuns, jobRuns } = deps;
  const startedRun = await assemblyRuns.getById(id);

  if (!startedRun || startedRun.args.job_run_id === jobRunId) {
    return false;
  }
  await jobRuns
    .fail(jobRunId, `superseded — already running as ${id}`)
    .catch(() => {});
  console.log(`${label} joined ${id}; job_run ${jobRunId} closed`);

  return true;
}
