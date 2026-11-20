import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  defineStation,
  type Brief,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  parsePullRequestUrl,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { pagedPacket } from "@re-cinq/lore-shared/review/paged-packet.js";
import { z } from "zod";
import { preparedEvidence } from "./prepared-evidence.js";

const exec = promisify(execFile);
const collector = fileURLToPath(
  new URL("../../../../../scripts/lore-review-pr.mjs", import.meta.url),
);

export function startPrepareReviewStation(): RunningStation {
  return defineStation("prepare-code-review", prepareReview);
}

const prepareReview: Handle = async ({ needs, visitId }, tools) => {
  const target = parsePullRequestUrl(needs.pr_url);

  await requireReviewRepository(visitId, target.repo);
  const stdout = await collect(collectorArgs(needs, target), tools.signal);
  const evidence = preparedEvidence(stdout, needs.previous_findings);

  if (typeof evidence === "string") {
    return { outcome: evidence };
  }

  await Promise.all(
    Object.entries(evidence).map(([name, packet]) =>
      tools.produce(name, pagedPacket(packet)),
    ),
  );

  return { outcome: "success" };
};

async function collect(args: string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await exec(process.execPath, args, {
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
    signal,
  });

  return stdout;
}

async function requireReviewRepository(
  visitId: string,
  repo: string,
): Promise<void> {
  const floor = floorClient();
  const visit = await floor.stationRuns.get(visitId);
  const run = visit && (await floor.runs.get(visit.runId))?.run;

  enforceTrue(
    run?.repo === floorRepoOf(repo),
    Error,
    "Review evidence requires a pull request in the run's repository",
  );
}

function collectorArgs(
  needs: Brief["needs"],
  { repo, prNumber }: ReturnType<typeof parsePullRequestUrl>,
): string[] {
  return [
    collector,
    "--repo=" + repo,
    "--pr=" + prNumber,
    "--head=" + needs.head_sha,
  ];
}
