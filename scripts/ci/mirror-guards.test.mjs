import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";

// The public mirror holds the same workflows as the private repo and has
// LORE_MIRROR=true. Every job of a workflow our pushes can start must be
// skipped there, or it commits to the mirror's main, releases twice or posts
// to Lore. A workflow listed here is exempt; each entry gives its reason.
const EXEMPT_WORKFLOWS = {
  "lore-ingest.yml":
    "its content is the template Lore installs in every onboarded repo (ingest-workflow.ts); on a mirror it is disabled in the repository's Actions settings",
};

const GUARD = "vars.LORE_MIRROR != 'true'";
const MIRROR_TRIGGERS = ["push", "schedule", "workflow_run", "release"];
const WORKFLOWS_DIR = ".github/workflows";

function triggersOf(workflow) {
  const on = workflow.on;

  if (typeof on === "string") {
    return [on];
  }

  if (Array.isArray(on)) {
    return on;
  }

  return Object.keys(on ?? {});
}

function runsFromMirrorPushes(workflow) {
  return triggersOf(workflow).some((trigger) =>
    MIRROR_TRIGGERS.includes(trigger),
  );
}

function topLevelConjuncts(expression) {
  const conjuncts = [];
  let depth = 0;
  let quote = null;
  let start = 0;

  for (let index = 0; index < expression.length; index++) {
    const character = expression[index];

    if (quote) {
      if (character === quote) {
        quote = null;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;
    } else if (
      depth === 0 &&
      character === "&" &&
      expression[index + 1] === "&"
    ) {
      conjuncts.push(expression.slice(start, index));
      start = index + 2;
      index++;
    }
  }
  conjuncts.push(expression.slice(start));

  return conjuncts.map((conjunct) => conjunct.replace(/\s+/g, " ").trim());
}

function isGuarded(condition) {
  if (condition === undefined) {
    return false;
  }
  const expression = String(condition)
    .trim()
    .replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1");

  return topLevelConjuncts(expression).includes(GUARD);
}

function unguardedJobs(workflow) {
  if (!runsFromMirrorPushes(workflow)) {
    return [];
  }

  return Object.entries(workflow.jobs)
    .filter(([, job]) => !isGuarded(job.if))
    .map(([name]) => name);
}

const pushWorkflowWithoutGuard = `
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps: [{ run: "echo" }]
`;

test("flags a job of a push workflow with no if", () => {
  assert.deepEqual(unguardedJobs(parse(pushWorkflowWithoutGuard)), ["deploy"]);
});

test("flags a job whose if tests LORE_MIRROR == 'true'", () => {
  const workflow = parse(
    pushWorkflowWithoutGuard.replace(
      "runs-on",
      "if: vars.LORE_MIRROR == 'true'\n    runs-on",
    ),
  );

  assert.deepEqual(unguardedJobs(workflow), ["deploy"]);
});

test("flags a job whose if misspells the variable as LORE_MIRRORS", () => {
  const workflow = parse(
    pushWorkflowWithoutGuard.replace(
      "runs-on",
      "if: vars.LORE_MIRRORS != 'true'\n    runs-on",
    ),
  );

  assert.deepEqual(unguardedJobs(workflow), ["deploy"]);
});

test("flags a job whose guard is or-ed with another condition", () => {
  const workflow = parse(
    pushWorkflowWithoutGuard.replace(
      "runs-on",
      "if: vars.LORE_MIRROR != 'true' || github.ref == 'refs/heads/main'\n    runs-on",
    ),
  );

  assert.deepEqual(unguardedJobs(workflow), ["deploy"]);
});

test("flags a job that calls a reusable workflow with no if", () => {
  const workflow = parse(`
on:
  schedule: [{ cron: "0 3 * * 0" }]
jobs:
  build:
    uses: ./.github/workflows/_build-image.yml
`);

  assert.deepEqual(unguardedJobs(workflow), ["build"]);
});

test("flags only the unguarded job of a workflow with a tag trigger", () => {
  const workflow = parse(`
on:
  push:
    tags: ["v*"]
jobs:
  verify:
    if: vars.LORE_MIRROR != 'true'
    runs-on: ubuntu-latest
  release:
    needs: verify
    runs-on: ubuntu-latest
`);

  assert.deepEqual(unguardedJobs(workflow), ["release"]);
});

test("passes a push job guarded alone", () => {
  const workflow = parse(
    pushWorkflowWithoutGuard.replace(
      "runs-on",
      "if: vars.LORE_MIRROR != 'true'\n    runs-on",
    ),
  );

  assert.deepEqual(unguardedJobs(workflow), []);
});

test("passes a push job whose guard is and-ed with its own condition, in either order and in ${{ }}", () => {
  const workflow = parse(`
on:
  push:
    branches: [main]
jobs:
  deploy:
    if: github.ref == 'refs/heads/main' && vars.LORE_MIRROR != 'true'
    runs-on: ubuntu-latest
  smoke:
    if: \${{ vars.LORE_MIRROR != 'true' && (a || b) }}
    runs-on: ubuntu-latest
`);

  assert.deepEqual(unguardedJobs(workflow), []);
});

test("passes a pull_request-only workflow with unguarded jobs", () => {
  const workflow = parse(`
on:
  pull_request:
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
`);

  assert.deepEqual(unguardedJobs(workflow), []);
});

test("every job of every workflow that push, schedule, workflow_run, release or a tag starts carries the LORE_MIRROR guard", () => {
  const unguarded = readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith(".yml") && !(file in EXEMPT_WORKFLOWS))
    .flatMap((file) =>
      unguardedJobs(
        parse(readFileSync(`${WORKFLOWS_DIR}/${file}`, "utf-8")),
      ).map((job) => `${file}: ${job}`),
    );

  assert.deepEqual(unguarded, []);
});
