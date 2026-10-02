// One repository's nightly context eval (specs/context-evals): pick tonight's documents, have lore-api evaluate each, write the summary, and fail when too few could be answered from what Lore returned.

import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { ApiRefusal, loreApi } from "./lore-api.mjs";
import { sampleDocuments } from "./sample.mjs";

// 500 is in the list because a rate limit of the model reaches the runner as one.
const RETRIED = new Set([429, 500, 502, 503, 504]);
const RETRY_AFTER_MS = [5000, 15000];

export async function runEval(run) {
  const { repo, threshold } = run;
  const api = loreApi(run);
  const results = [];

  for (const path of await documentsToEvaluate(api, run)) {
    results.push(await evaluate(api, run, path));
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
async function documentsToEvaluate(api, run) {
  if (run.path) {
    return [run.path];
  }
  const { documents } = await patiently(run, () =>
    api.get(
      `/api/context-evals/documents?repo=${encodeURIComponent(run.repo)}`,
    ),
  );

  return sampleDocuments(documents, run.date, run.sample);
}

/** One document's verdict. Whatever goes wrong asking for it is that document's failure and not the run's, so one bad document or one dropped connection cannot hide the other nineteen. */
async function evaluate(api, run, path) {
  try {
    return await patiently(run, () =>
      api.post("/api/context-evals", { repo: run.repo, path }),
    );
  } catch (failure) {
    return unanswered(path, reasonOf(failure));
  }
}

/** A refusal that may pass and a connection that failed are asked again, twice, with a wait between; the last failure is thrown. */
async function patiently({ pause = wait }, call) {
  let failure;

  for (const delay of [0, ...RETRY_AFTER_MS]) {
    if (delay > 0) {
      await pause(delay);
    }

    try {
      return await call();
    } catch (err) {
      failure = err;

      if (err instanceof ApiRefusal && !RETRIED.has(err.status)) {
        break;
      }
    }
  }

  throw failure;
}

function unanswered(path, reason) {
  return {
    path,
    question: "",
    found: false,
    answered: false,
    useful_share: 0,
    reason,
    model: "",
  };
}

function reasonOf(failure) {
  if (failure instanceof ApiRefusal) {
    return failure.message;
  }
  const cause = failure.cause ? ` (${failure.cause.message})` : "";

  return `could not reach lore-api: ${failure.message}${cause}`;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

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

// A run of one document is someone checking that document: it has no miss to spare.
function allowedMisses(total, threshold) {
  return total <= 1
    ? 0
    : Math.max(1, Math.floor(total * (1 - threshold) + 1e-9));
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
