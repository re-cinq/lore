// One repository's nightly context eval (specs/context-evals): pick tonight's documents, have lore-api evaluate each, write the summary, and fail when too few could be answered from what Lore returned.

import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { ApiRefusal, loreApi } from "./lore-api.mjs";
import { sampleDocuments } from "./sample.mjs";

const RETRIED = new Set([429, 502, 503, 504]);

export async function runEval(run) {
  const { repo, threshold } = run;
  const api = loreApi(run);
  const results = [];

  for (const path of await documentsToEvaluate(api, run)) {
    results.push(await evaluate(api, repo, path));
  }
  const stats = summarize(results);

  return {
    results,
    stats,
    passed: passes(stats, threshold),
    markdown: renderSummary(repo, results, threshold),
  };
}

/** Tonight's window of the repository's documents, or the one document a manual run names: someone checking the ADR they just merged should not have to wait for its night. */
async function documentsToEvaluate(api, { repo, path, date, sample }) {
  if (path) {
    return [path];
  }
  const { documents } = await api.get(
    `/api/context-evals/documents?repo=${encodeURIComponent(repo)}`,
  );

  return sampleDocuments(documents, date, sample);
}

/** One document's verdict; a refusal from lore-api is that document's failure, not the run's, so one bad document cannot hide the other nineteen. */
async function evaluate(api, repo, path) {
  const ask = () => api.post("/api/context-evals", { repo, path });

  try {
    return await ask().catch((refusal) => {
      if (RETRIED.has(refusal.status)) {
        return ask();
      }
      throw refusal;
    });
  } catch (refusal) {
    if (!(refusal instanceof ApiRefusal)) {
      throw refusal;
    }

    return {
      path,
      question: "",
      found: false,
      answered: false,
      useful_share: 0,
      reason: refusal.message,
      model: "",
    };
  }
}

export function summarize(results) {
  const count = (holds) => results.filter(holds).length;
  const shares = results.reduce((sum, result) => sum + result.useful_share, 0);

  return {
    total: results.length,
    found: count((result) => result.found),
    answered: count((result) => result.answered),
    usefulShare:
      results.length === 0
        ? 0
        : Math.round((shares / results.length) * 100) / 100,
  };
}

/** A repository passes on what could be answered: a question answered correctly from other documents is Lore doing its job, so "found" is reported and gates nothing. One miss is always allowed, or a repository of four documents would turn red on a single one. */
function passes(stats, threshold) {
  return stats.total - stats.answered <= allowedMisses(stats.total, threshold);
}

function allowedMisses(total, threshold) {
  return Math.max(1, Math.floor(total * (1 - threshold) + 1e-9));
}

export function renderSummary(repo, results, threshold) {
  if (results.length === 0) {
    return `## Context evals: ${repo}\n\n${repo} has no ingested ADRs or specs: nothing to evaluate.\n`;
  }
  const stats = summarize(results);
  const verdict = passes(stats, threshold) ? "pass" : "**fail**";
  const failed = results.filter((result) => !(result.found && result.answered));

  return [
    `## Context evals: ${repo}`,
    "",
    "| Repository | Found | Answered | Useful share | Verdict |",
    "| --- | --- | --- | --- | --- |",
    `| ${repo} | ${stats.found} / ${stats.total} | ${stats.answered} / ${stats.total} | ${percent(stats.usefulShare)} | ${verdict} |`,
    "",
    ...failedTable(failed),
  ].join("\n");
}

function failedTable(failed) {
  if (failed.length === 0) {
    return ["Every document was found and answered.", ""];
  }

  return [
    "### Documents not answered, or answered without being found",
    "",
    "| Document | Question | Found | Answered | Useful | Why |",
    "| --- | --- | --- | --- | --- | --- |",
    ...failed.map(
      (result) =>
        `| ${result.path} | ${cell(result.question)} | ${yesNo(result.found)} | ${yesNo(result.answered)} | ${percent(result.useful_share)} | ${cell(result.reason)} |`,
    ),
    "",
  ];
}

const percent = (share) => `${Math.round(share * 100)}%`;
const yesNo = (flag) => (flag ? "yes" : "no");
const cell = (text) =>
  String(text ?? "")
    .replaceAll("|", "\\|")
    .replaceAll(/\s+/g, " ");

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      path: { type: "string" },
      sample: { type: "string", default: "20" },
      threshold: { type: "string", default: "0.85" },
      date: { type: "string", default: new Date().toISOString().slice(0, 10) },
    },
  });
  const outcome = await runEval({
    env: process.env,
    repo: values.repo,
    path: values.path,
    date: values.date,
    sample: Number(values.sample),
    threshold: Number(values.threshold),
  });

  console.log(outcome.markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${outcome.markdown}\n`);
  }

  if (!outcome.passed) {
    console.error(
      `::error::${values.repo}: ${outcome.stats.answered} of ${outcome.stats.total} questions could be answered from what Lore returned, below the bar of ${values.threshold}`,
    );
    process.exitCode = 1;
  }
}
