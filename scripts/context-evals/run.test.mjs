import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSummary, runEval, summarize } from "./run.mjs";

const ENV = { LORE_API_URL: "https://lore.example", LORE_INGEST_TOKEN: "tok" };
const ADR = (n) => `adrs/ADR-${n}.md`;

const verdict = (path, over = {}) => ({
  path,
  question: `What does ${path} decide?`,
  found: true,
  answered: true,
  useful_share: 0.5,
  reason: "Agrees with the document.",
  model: "gemini-2.5-flash",
  ...over,
});

function loreApi({ documents, verdicts = {}, failing = {} }) {
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);

    requests.push({
      method: init.method ?? "GET",
      pathname,
      repo: searchParams.get("repo"),
      authorization: init.headers?.Authorization,
      body: init.body ? JSON.parse(init.body) : undefined,
    });

    if (pathname === "/api/context-evals/documents") {
      return Response.json({ documents });
    }
    const { path } = JSON.parse(init.body);

    return failing[path]
      ? Response.json({ error: "boom" }, { status: failing[path] })
      : Response.json(verdicts[path] ?? verdict(path));
  };

  return { fetchFn, requests };
}

const run = (api, over = {}) =>
  runEval({
    env: ENV,
    fetchFn: api.fetchFn,
    repo: "re-cinq/lore",
    date: "2026-10-02",
    sample: 20,
    threshold: 0.85,
    ...over,
  });

test("passes re-cinq/lore when all 3 documents are found and answered", async () => {
  const api = loreApi({ documents: [ADR(1), ADR(2), ADR(3)] });
  const outcome = await run(api);

  assert.deepEqual(
    { passed: outcome.passed, stats: outcome.stats },
    {
      passed: true,
      stats: { total: 3, found: 3, answered: 3, both: 3, usefulShare: 0.5 },
    },
  );
});

test("lists the repository's documents and posts each one with the bearer token", async () => {
  const api = loreApi({ documents: [ADR(1)] });

  await run(api);

  assert.deepEqual(api.requests, [
    {
      method: "GET",
      pathname: "/api/context-evals/documents",
      repo: "re-cinq/lore",
      authorization: "Bearer tok",
      body: undefined,
    },
    {
      method: "POST",
      pathname: "/api/context-evals",
      repo: null,
      authorization: "Bearer tok",
      body: { repo: "re-cinq/lore", path: ADR(1) },
    },
  ]);
});

test("fails the repository when 8 of 10 documents pass and the bar is 0.85", async () => {
  const documents = Array.from({ length: 10 }, (_, index) => ADR(index + 1));
  const api = loreApi({
    documents,
    verdicts: {
      [ADR(1)]: verdict(ADR(1), { found: false, answered: false }),
      [ADR(2)]: verdict(ADR(2), { answered: false }),
    },
  });
  const outcome = await run(api);

  assert.deepEqual(
    { passed: outcome.passed, both: outcome.stats.both },
    { passed: false, both: 8 },
  );
});

test("passes with nothing evaluated when the repository has no ADRs or specs", async () => {
  const api = loreApi({ documents: [] });
  const outcome = await run(api);

  assert.deepEqual(
    { passed: outcome.passed, total: outcome.stats.total },
    { passed: true, total: 0 },
  );
  assert.equal(api.requests.length, 1);
});

test("counts a document lore-api answers 500 for as neither found nor answered, with the status as the reason", async () => {
  const api = loreApi({ documents: [ADR(1)], failing: { [ADR(1)]: 500 } });
  const outcome = await run(api);

  assert.deepEqual(outcome.results, [
    {
      path: ADR(1),
      question: "",
      found: false,
      answered: false,
      useful_share: 0,
      reason: "lore-api answered 500: boom",
      model: "",
    },
  ]);
});

test("asks lore-api a second time when the first answer for a document is a 503", async () => {
  let calls = 0;
  const api = loreApi({ documents: [ADR(1)] });
  const flaky = async (url, init) => {
    if (init?.method === "POST" && calls++ === 0) {
      return Response.json({ error: "busy" }, { status: 503 });
    }

    return api.fetchFn(url, init);
  };
  const outcome = await run(api, { fetchFn: flaky });

  assert.equal(outcome.stats.both, 1);
});

test("refuses to run without LORE_INGEST_TOKEN, naming it", async () => {
  await assert.rejects(
    run(loreApi({ documents: [] }), { env: { LORE_API_URL: "https://x" } }),
    new Error(
      "LORE_INGEST_TOKEN is not set: the context evals cannot ask Lore",
    ),
  );
});

test("refuses to run without LORE_API_URL, naming it", async () => {
  await assert.rejects(
    run(loreApi({ documents: [] }), { env: { LORE_INGEST_TOKEN: "tok" } }),
    new Error("LORE_API_URL is not set: the context evals cannot ask Lore"),
  );
});

test("summarizes 2 results as found 1, answered 1, both 1 and a mean useful share of 0.4", () => {
  assert.deepEqual(
    summarize([
      verdict(ADR(1), { useful_share: 0.6 }),
      verdict(ADR(2), { found: false, answered: false, useful_share: 0.2 }),
    ]),
    { total: 2, found: 1, answered: 1, both: 1, usefulShare: 0.4 },
  );
});

test("renders the repository's row and lists only the failing document with its question and reason", () => {
  const results = [
    verdict(ADR(1)),
    verdict(ADR(2), { answered: false, reason: "Contradicts the ADR." }),
  ];
  const markdown = renderSummary("re-cinq/lore", results, 0.85);

  assert.deepEqual(
    markdown.split("\n").filter((line) => line.startsWith("|")),
    [
      "| Repository | Found | Answered | Useful share | Verdict |",
      "| --- | --- | --- | --- | --- |",
      "| re-cinq/lore | 2 / 2 | 1 / 2 | 50% | **fail** |",
      "| Document | Question | Found | Answered | Useful | Why |",
      "| --- | --- | --- | --- | --- | --- |",
      "| adrs/ADR-2.md | What does adrs/ADR-2.md decide? | yes | no | 50% | Contradicts the ADR. |",
    ],
  );
});

test("renders a note instead of a table for a repository with no documents", () => {
  assert.match(
    renderSummary("re-cinq/empty", [], 0.85),
    /re-cinq\/empty has no ingested ADRs or specs: nothing to evaluate/,
  );
});
