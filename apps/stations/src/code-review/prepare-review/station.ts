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
import { z } from "zod";

const exec = promisify(execFile);
const collector = fileURLToPath(
  new URL("../../../../../scripts/lore-review-pr.mjs", import.meta.url),
);
const packet = z.object({ mode: z.string() }).passthrough();
const packets = z.object({
  code_evidence: packet,
  test_evidence: packet,
  intent_evidence: packet,
  challenge_evidence: packet,
  product_evidence: packet,
});

export function startPrepareReviewStation(): RunningStation {
  return defineStation("prepare-code-review", prepareReview);
}

const prepareReview: Handle = async ({ needs, visitId }, tools) => {
  const target = parsePullRequestUrl(needs.pr_url);

  await requireReviewRepository(visitId, target.repo);
  const args = collectorArgs(needs, target);
  const options = {
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
    signal: tools.signal,
  };
  const { stdout } = await exec(process.execPath, args, options);
  const evidence = preparedPackets(stdout, needs.previous_findings);

  await Promise.all(
    Object.entries(evidence).map(([name, packet]) =>
      tools.produce(name, JSON.stringify(packet)),
    ),
  );

  return { outcome: "success" };
};

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
  const paths = needs.review_paths
    ? z.array(z.string()).parse(JSON.parse(needs.review_paths))
    : [];

  return [
    collector,
    "--evidence-only",
    "--repo=" + repo,
    "--pr=" + prNumber,
    "--head=" + needs.head_sha,
    ...(needs.since_sha ? ["--since", needs.since_sha] : []),
    ...paths.map((path) => "--paths=" + path),
  ];
}

function preparedPackets(stdout: string, previous?: string) {
  const collected = JSON.parse(stdout);

  enforceTrue(
    collected.status !== "superseded",
    Error,
    "The pull request changed during evidence preparation",
  );
  const evidence = packets.parse(collected);

  if (previous) {
    evidence.product_evidence.previous_findings = previous;
  }

  return evidence;
}
