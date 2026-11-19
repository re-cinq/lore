import { readFile } from "node:fs/promises";
import { cases } from "./cases.mjs";

if (process.argv.length < 3) {
  throw new Error(
    "Usage: node scripts/review-pilot/score.mjs /path/to/results.jsonl",
  );
}
const rows = (
  await Promise.all(process.argv.slice(2).map((path) => readFile(path, "utf8")))
).flatMap((data) =>
  data
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
);
const expectedVerdicts = new Map(cases.map(({ id, verdict }) => [id, verdict]));
const stages = ["code", "tests", "intent", "challenge", "product"];

function complete(text) {
  return (
    /^LORE_NODE_RESULT:\s*\{\s*"outcome"\s*:\s*"success"\s*\}\s*$/m.test(
      text,
    ) && /"status":\s*"complete"/.test(text)
  );
}

function floorVerdict(row) {
  return stages.some(
    (stage) =>
      row.arm.match(/^(full|light)$/) &&
      !complete(row.results[stage]?.text ?? ""),
  )
    ? "incomplete"
    : row.verdict;
}

function median(values) {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
}

for (const arm of new Set(rows.map((row) => row.arm))) {
  const trials = rows.filter((row) => row.arm === arm);
  const byFixture = Object.fromEntries(
    cases.map(({ id }) => [
      id,
      trials
        .filter((row) => row.fixture === id)
        .sort((a, b) => a.repeat - b.repeat)
        .map((row) => ({
          verdict: floorVerdict(row),
          reportedVerdict: row.verdict,
          incompleteStages: stages.filter(
            (stage) => row.results[stage] && !complete(row.results[stage].text),
          ),
        })),
    ]),
  );
  const processTimes = trials.map(({ results }) =>
    Object.values(results).reduce((sum, result) => sum + (result.ms ?? 0), 0),
  );
  const processes = trials.flatMap(({ results }) =>
    Object.values(results).filter((result) => result.usage),
  );
  const usages = processes.map(({ usage }) => usage);
  const sum = (extract) =>
    usages.reduce((total, usage) => total + (extract(usage) ?? 0), 0);

  console.log(
    JSON.stringify(
      {
        arm,
        trials: trials.length,
        matchingVerdicts: trials.filter(
          (row) => expectedVerdicts.get(row.fixture) === floorVerdict(row),
        ).length,
        falseBlockers: trials.filter(
          (row) =>
            expectedVerdicts.get(row.fixture) === "approve" &&
            floorVerdict(row) === "request_changes",
        ).length,
        incomplete: trials.filter((row) => floorVerdict(row) === "incomplete")
          .length,
        medianWallMs: median(trials.map(({ ms }) => ms)),
        medianProcessMs: median(processTimes),
        tokens: {
          input: sum((usage) => usage.input_tokens),
          cachedReads: sum(
            (usage) =>
              usage.cache_read_input_tokens ?? usage.cached_input_tokens,
          ),
          cachedWrites: sum(
            (usage) =>
              usage.cache_creation_input_tokens ??
              usage.cache_write_input_tokens,
          ),
          output: sum((usage) => usage.output_tokens),
        },
        costUsd: processes.some(({ cost }) => cost !== undefined)
          ? processes.reduce((total, { cost = 0 }) => total + cost, 0)
          : null,
        byFixture,
      },
      null,
      2,
    ),
  );
}
