import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import type { PullRequestRef } from "./floor-review-runs.js";

const exec = promisify(execFile);
const collector = fileURLToPath(
  new URL("../../../../../scripts/lore-review-pr.mjs", import.meta.url),
);
const launching = new Set<string>();

const collectorResult = z.object({
  status: z.enum(["shadow_started", "superseded"]),
  runId: z.uuid().optional(),
});

export type StartReviewShadow = (
  repo: string,
  prNumber: number,
  head: string,
) => Promise<void>;

/** The baseline line continues even if shadow evidence preparation fails. */
export function queueReviewShadow(
  start: StartReviewShadow | undefined,
  { repo, prNumber }: PullRequestRef,
  headSha: string | undefined,
): void {
  if (!start || !headSha) {
    return;
  }

  void Promise.resolve()
    .then(() => start(repo, prNumber, headSha))
    .catch(() => {
      console.warn("[code-review-shadow] Launch failed", {
        repo,
        prNumber,
        headSha,
      });
    });
}

export async function launchReviewShadow(
  repo: string,
  prNumber: number,
  headSha: string,
): Promise<void> {
  const key = `${repo.toLowerCase()}#${prNumber}:${headSha}`;

  if (!shadowEnabled(repo) || launching.has(key)) {
    return;
  }

  launching.add(key);

  try {
    const { stdout } = await collect(repo, prNumber, headSha);

    reportCollector({ repo, prNumber }, headSha, stdout);
  } finally {
    launching.delete(key);
  }
}

function reportCollector(
  target: PullRequestRef,
  headSha: string,
  stdout: string,
): void {
  console.info("[code-review-shadow] Collector finished", {
    ...target,
    headSha,
    result: safeCollectorResult(stdout),
  });
}

function shadowEnabled(repo: string): boolean {
  const entries = (process.env.LORE_REVIEW_SHADOW_REPOS ?? "").split(",");

  return entries.some(
    (entry) => entry.trim().toLowerCase() === repo.toLowerCase(),
  );
}

function collect(repo: string, prNumber: number, headSha: string) {
  const args = [
    collector,
    "--repo",
    repo,
    "--pr",
    String(prNumber),
    "--head",
    headSha,
  ];

  return exec(process.execPath, args, {
    timeout: 300_000,
    maxBuffer: 64 * 1024,
  });
}

function safeCollectorResult(
  stdout: string,
): z.infer<typeof collectorResult> | undefined {
  try {
    return collectorResult.safeParse(JSON.parse(stdout)).data;
  } catch {
    return;
  }
}
