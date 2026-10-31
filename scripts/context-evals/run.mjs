// One repository's context eval (specs/context-evals), run from a developer machine: pick the day's documents, have lore-api evaluate each, write the summary, and fail when too few could be answered from what Lore returned.

import { appendFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { ApiRefusal, loreApi, patiently } from "./lore-api.mjs";
import { sampleDocuments } from "./sample.mjs";
import { runTickets } from "./tickets.mjs";

const BACKENDS = ["lore", "utopia", "both"];

export async function runEval(run) {
  const { repo, threshold, backend } = run;

  if (backend !== undefined && !BACKENDS.includes(backend)) {
    throw new Error(`--backend must be lore, utopia or both, not ${backend}`);
  }
  const api = loreApi(run);
  const results = [];

  for (const path of await documentsToEvaluate(api, run)) {
    results.push(await evaluate(api, run, path));
  }
  const sideBySide = backend === "both";
  // Utopia is under evaluation: a side-by-side run is gated on Lore's numbers alone.
  const stats = summarize(
    sideBySide ? results.map((result) => sideOf(result, "lore")) : results,
  );

  return {
    results,
    stats,
    passed: passes(stats, threshold),
    markdown: sideBySide
      ? renderSideBySide(repo, results, threshold)
      : renderSummary(repo, results, threshold),
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
      api.post("/api/context-evals", {
        repo: run.repo,
        path,
        ...(run.backend ? { backend: run.backend } : {}),
      }),
    );
  } catch (failure) {
    return unanswered(path, reasonOf(failure));
  }
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
    sources: [],
  };
}

function reasonOf(failure) {
  if (failure instanceof ApiRefusal) {
    return failure.message;
  }
  const cause = failure.cause ? ` (${failure.cause.message})` : "";

  return `could not reach lore-api: ${failure.message}${cause}`;
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

/** One store's grade of a side-by-side result, in the shape of a single-store one; a document whose request failed has no sides and stands for both. */
export function sideOf(result, side) {
  const verdict = result[side];

  return verdict
    ? { path: result.path, question: result.question, ...verdict }
    : result;
}

/** Each store's numbers over tonight's side-by-side results, the mean overlap of their sources, and how often one store alone let the question be answered. */
export function compareSides(results) {
  const overlaps = results
    .map((result) => result.top_k_overlap)
    .filter((overlap) => typeof overlap === "number");
  const answeredOnlyBy = (side) =>
    results.filter((result) => result.only_answered_by === side).length;

  return {
    lore: summarize(results.map((result) => sideOf(result, "lore"))),
    utopia: summarize(results.map((result) => sideOf(result, "utopia"))),
    meanOverlap:
      overlaps.length === 0
        ? 0
        : Math.round(
            (overlaps.reduce((sum, overlap) => sum + overlap, 0) /
              overlaps.length) *
              100,
          ) / 100,
    onlyLore: answeredOnlyBy("lore"),
    onlyUtopia: answeredOnlyBy("utopia"),
  };
}

export function renderSideBySide(repo, results, threshold) {
  if (results.length === 0) {
    return renderSummary(repo, results, threshold);
  }
  const comparison = compareSides(results);
  const verdict = passes(comparison.lore, threshold) ? "pass" : "**fail**";
  const row = (name, stats, alone) =>
    `| ${name} | ${stats.found} / ${stats.total} | ${stats.answered} / ${stats.total} | ${percent(stats.usefulShare)} | ${alone} |`;
  const loreResults = results.map((result) => sideOf(result, "lore"));

  return [
    `## Context evals: ${repo}, Lore and Utopia side by side`,
    "",
    "| Store | Found | Answered | Useful share | Answered alone |",
    "| --- | --- | --- | --- | --- |",
    row("Lore", comparison.lore, comparison.onlyLore),
    row("Utopia", comparison.utopia, comparison.onlyUtopia),
    "",
    `Mean source overlap: ${percent(comparison.meanOverlap)}. Verdict, on Lore's numbers alone: ${verdict}`,
    "",
    ...failedTable(
      loreResults.filter((result) => !(result.found && result.answered)),
    ),
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
      backend: {
        type: "string",
        default: process.env.LORE_EVAL_BACKEND || "lore",
      },
      tickets: { type: "string" },
      results: { type: "string" },
    },
  });
  const { backend, repo } = values;
  const outcome = values.tickets
    ? await runTickets({
        env: process.env,
        repo,
        backend,
        count: Number(values.tickets),
      })
    : await runEval({
        env: process.env,
        repo,
        backend,
        path: values.path,
        date: values.date,
        sample: Number(values.sample),
        threshold: Number(values.threshold),
      });

  console.log(outcome.markdown);

  if (values.results) {
    writeFileSync(
      values.results,
      `${JSON.stringify(outcome.results, null, 2)}\n`,
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${outcome.markdown}\n`);
  }

  if (outcome.passed === false) {
    console.error(
      `::error::${values.repo}: ${outcome.stats.answered} of ${outcome.stats.total} questions could be answered from what Lore returned, below the bar of ${values.threshold}`,
    );
    process.exitCode = 1;
  }
}
