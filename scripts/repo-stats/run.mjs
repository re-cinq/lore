// What Lore did on a set of repositories over the last weeks, as an internal markdown report: `node scripts/repo-stats/run.mjs --out <dir> [--repos o/r,o/r] [--weeks 8] [--with-db]`. Needs LORE_API_URL + LORE_INGEST_TOKEN (or `git config --global lore.api-url` / `lore.ingest-token`), a logged-in `gh`, and for --with-db a kubectl context on the production cluster.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loreApi } from "../context-evals/lore-api.mjs";
import { blockedSpans, collectRepo } from "./collect.mjs";
import { renderReport } from "./report.mjs";
import {
  blockers,
  combine,
  helped,
  weeklyStats,
  windowWeeks,
} from "./weekly.mjs";

const OLE_LARSON_REPOS = "re-cinq/otto,re-cinq/bowman-ui,re-cinq/HALEngine";

// The same fallback the MCP runner and the VS Code extension use: install.sh keeps the address and token in the global git config.
function gitConfig(key) {
  try {
    return execFileSync("git", ["config", "--global", key], {
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

const loreEnv = (env) => ({
  ...env,
  LORE_API_URL: env.LORE_API_URL || gitConfig("lore.api-url"),
  LORE_INGEST_TOKEN: env.LORE_INGEST_TOKEN || gitConfig("lore.ingest-token"),
});

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
  const pooled = combine(raws);
  const stats = {
    repos,
    weekly: weeklyStats(pooled, weeks, now),
    helped: helped(pooled, weeks),
    blockers: blockers(pooled, weeks, now),
  };

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
    env: loreEnv(process.env),
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
