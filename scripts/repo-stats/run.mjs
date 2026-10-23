// What Lore did on a set of repositories over the last weeks, as an internal markdown report: `node scripts/repo-stats/run.mjs --out <dir> [--repos o/r,o/r] [--weeks 8] [--with-db]`. Needs LORE_API_URL + LORE_INGEST_TOKEN, a logged-in `gh`, and for --with-db a kubectl context on the production cluster.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loreApi } from "../context-evals/lore-api.mjs";
import { blockedSpans, collectRepo } from "./collect.mjs";
import { renderReport } from "./report.mjs";
import { blockers, helped, weeklyStats, windowWeeks } from "./weekly.mjs";

const OLE_LARSON_REPOS = "re-cinq/otto,re-cinq/bowman-ui,re-cinq/HALEngine";

export async function buildReport({ env, repos, weekCount, withDb, now }) {
  const api = loreApi({ env });
  const weeks = windowWeeks(now, weekCount);
  const since = weeks[0].from;
  const [collected, spans] = await Promise.all([
    Promise.all(
      repos.map((repo) => collectRepo({ api, repo, since, weekCount })),
    ),
    withDb ? blockedSpans(repos, since) : [],
  ]);
  const raws = collected.map((raw) => ({
    ...raw,
    blocked: spans.filter((span) => span.repo === raw.repo.toLowerCase()),
  }));
  const stats = raws.map((raw) => ({
    repo: raw.repo,
    weekly: weeklyStats(raw, weeks, now),
    helped: helped(raw, weeks),
    blockers: blockers(raw, weeks, now),
  }));

  return {
    raws,
    markdown: renderReport(stats, weeks, { generatedAt: now, withDb }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      repos: { type: "string", default: OLE_LARSON_REPOS },
      weeks: { type: "string", default: "8" },
      out: { type: "string", default: "repo-stats" },
      "with-db": { type: "boolean", default: false },
    },
  });
  const { raws, markdown } = await buildReport({
    env: process.env,
    repos: values.repos.split(","),
    weekCount: Number(values.weeks),
    withDb: values["with-db"],
    now: new Date().toISOString(),
  });

  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, "report.md"), markdown);
  writeFileSync(
    join(values.out, "raw.json"),
    `${JSON.stringify(raws, null, 2)}\n`,
  );
  console.log(`[lore] wrote ${join(values.out, "report.md")} and raw.json`);
}
