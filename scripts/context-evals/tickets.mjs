// A repository's ticket evals (specs/context-evals FR5.11): the last N issues that carry a `priority:*` label, each graded by lore-api on the block an implementer would be handed, rendered as a table per backend.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loreApi, patiently } from "./lore-api.mjs";

const SIDES = ["lore", "utopia"];
const ISSUES_READ = 60;

async function issuesFromGh(repo) {
  const { stdout } = await promisify(execFile)("gh", [
    "issue",
    "list",
    "-R",
    repo,
    "--state",
    "all",
    "--limit",
    String(ISSUES_READ),
    "--json",
    "number,title,body,labels",
  ]);

  return JSON.parse(stdout);
}

const hasPriority = (issue) =>
  issue.labels.some((label) => label.name.startsWith("priority:"));

export async function runTickets(run) {
  const { repo, count, backend = "lore", listIssues = issuesFromGh } = run;
  const api = loreApi(run);
  const issues = (await listIssues(repo)).filter(hasPriority).slice(0, count);
  const results = [];

  for (const { number, title, body } of issues) {
    const graded = await patiently(run, () =>
      api.post("/api/context-evals/ticket", {
        repo,
        ticket: { number, title, body: body ?? "" },
        backend,
      }),
    );

    results.push({ number, title, ...sidesOf(graded, backend) });
  }

  return { results, markdown: renderTickets(repo, results, backend) };
}

const sidesOf = (graded, backend) =>
  backend === "both" ? graded : { [backend]: graded };

const mean = (values) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted.length === 0 ? 0 : sorted[Math.ceil(sorted.length / 2) - 1];
}

export function renderTickets(repo, results, backend) {
  const sides = backend === "both" ? SIDES : [backend];

  return [
    `## Ticket evals: ${repo}, ${results.length} tickets`,
    "",
    ...sides.flatMap((side) => sideTable(side, results)),
  ].join("\n");
}

function sideTable(side, results) {
  const graded = results.filter((result) => result[side]);
  const verdicts = graded.map((result) => result[side]);

  return [
    `### ${side}`,
    "",
    `Mean score ${mean(verdicts.map((v) => v.score)).toFixed(2)}, mean block ${Math.round(mean(verdicts.map((v) => v.chars)))} chars, p50 latency ${median(verdicts.map((v) => v.latency_ms))} ms.`,
    "",
    "| Ticket | Score | Useful | Noise |",
    "| --- | --- | --- | --- |",
    ...graded.map(
      ({ number, title, [side]: v }) =>
        `| #${number} ${cell(title)} | ${v.score} | ${cell(v.useful.join("; "))} | ${cell(v.noise)} |`,
    ),
    "",
  ];
}

const cell = (text) =>
  String(text ?? "")
    .replaceAll("|", "\\|")
    .replaceAll(/\s+/g, " ");
