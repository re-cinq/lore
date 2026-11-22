// The one-story review run on a developer's machine: the same prompts as the hosted line, each given only its own files, and the same comment and verdict.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { promisify, parseArgs } from "node:util";
import { pagedPacket } from "@re-cinq/lore-shared/review/paged-packet.js";
import {
  formalReview,
  storyPasses,
  storyReview,
} from "@re-cinq/lore-shared/review/story/story.js";
import { docsEvidence, onlyLinksChanged } from "./lore-review-docs.mjs";
import { storyPackets } from "./lore-review-packets.mjs";

const exec = promisify(execFile);
const STEPS = [
  { pass: "story", agent: "review-story", reads: ["tests.json"] },
  {
    pass: "implementation_check",
    agent: "review-implementation",
    reads: ["story.txt", "code.json", "tests.json"],
  },
  {
    pass: "issue_check",
    agent: "review-issue",
    reads: [
      "story.txt",
      "implementation-check.txt",
      "issue.json",
      "code.json",
      "tests.json",
    ],
  },
  { pass: "docs_check", agent: "review-docs", reads: ["docs.json"] },
];

async function definitionOf(agent) {
  const file = await readFile(
    new URL(`../libs/shared/src/agent-defaults/${agent}.md`, import.meta.url),
    "utf8",
  );
  const [, ...body] = file.split("\n---\n");

  return { prompt: body.join("\n---\n") };
}

// Each step runs in a directory of its own, so the story cannot borrow from the code or the issue.
async function ask({ agent, reads }, files, model) {
  const cwd = await mkdtemp(join(tmpdir(), "lore-review-"));

  try {
    const definition = await definitionOf(agent);

    await Promise.all(
      reads.map((name) => writeFile(join(cwd, name), files[name])),
    );
    const { stdout } = await exec(
      "claude",
      [
        "-p",
        // The documents check reads the repository at /workspace/target: here, the working tree the review runs in.
        definition.prompt
          .replaceAll("/workspace/target", process.cwd())
          .replaceAll("/workspace/", cwd + "/"),
        // The hosted agents run on Gemini; a local review runs on the developer's own Claude Code, on its default model unless one is asked for.
        ...(model ? ["--model", model] : []),
        "--allowedTools",
        "Read,Grep,Glob",
        "--output-format",
        "json",
      ],
      {
        cwd,
        timeout: 900_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
          CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        },
      },
    );

    return JSON.parse(stdout).result ?? "";
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function answersOf(files, required, model) {
  const outputs = {};

  for (const step of STEPS.filter(({ pass }) => required.includes(pass))) {
    try {
      outputs[step.pass] = await ask(step, files, model);
    } catch {
      break;
    }
    files["story.txt"] ??= outputs.story;
    files["implementation-check.txt"] ??= outputs.implementation_check;
  }

  return outputs;
}

/** The passes a change needs, as the hosted line decides them: none for one that moves only links, the documents check alone for documents alone, and the documents check after the story's passes when a change of code also rewrites a document. */
function requiredPasses(snapshot, docs) {
  const documents = snapshot.documents ?? [];
  const written = docs && docs.statements.length + docs.removed.length > 0;

  if (!snapshot.files.length && documents.length) {
    return onlyLinksChanged(documents) ? [] : ["docs_check"];
  }

  return written ? [...storyPasses, "docs_check"] : storyPasses;
}

async function run() {
  const { values } = parseArgs({
    options: { model: { type: "string" }, revision: { type: "string" } },
  });
  const snapshot = JSON.parse(await text(process.stdin));
  const docs = snapshot.documents?.length
    ? await docsEvidence(snapshot.documents, (path) =>
        readFile(path, "utf8").catch(() => null),
      )
    : null;
  const required = requiredPasses(snapshot, docs);
  // As on the hosted line, the issue check is given a spec as statements, never whole.
  const packets = snapshot.files.length
    ? storyPackets({
        ...snapshot,
        documents: snapshot.documents?.filter(
          ({ path }) => !/^specs\/.*\/spec\.md$/.test(path),
        ),
      })
    : {};
  const outputs = await answersOf(
    {
      ...(snapshot.files.length && {
        "tests.json": pagedPacket(packets.test_evidence),
        "code.json": pagedPacket(packets.code_evidence),
        "issue.json": pagedPacket(packets.issue_evidence),
      }),
      ...(docs && { "docs.json": pagedPacket(docs) }),
    },
    required,
    values.model,
  );
  const { incomplete, comment } = storyReview(outputs, required);
  const complete = incomplete.length === 0;

  console.log(
    JSON.stringify({
      status: complete ? "complete" : "incomplete",
      incomplete,
      comment: comment(
        values.revision ?? "working tree",
        complete ? "complete" : "running",
      ),
      review: formalReview(outputs, required),
    }),
  );
  process.exitCode = complete ? 0 : 1;
}

try {
  await run();
} catch (error) {
  console.log(JSON.stringify({ status: "incomplete", reason: error.message }));
  process.exitCode = 1;
}
