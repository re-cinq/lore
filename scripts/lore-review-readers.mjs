// The one-story review run on a developer's machine: the same three prompts as the hosted line, each given only its own files, and the same comment and verdict.
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
];

async function definitionOf(agent) {
  const file = await readFile(
    new URL(`../libs/shared/src/agent-defaults/${agent}.md`, import.meta.url),
    "utf8",
  );
  const [frontmatter, ...body] = file.split("\n---\n");

  return {
    model: /^model: (\S+)$/m.exec(frontmatter)[1],
    prompt: body.join("\n---\n"),
  };
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
        definition.prompt.replaceAll("/workspace/", cwd + "/"),
        "--model",
        model ?? definition.model,
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

async function answersOf(files, model) {
  const outputs = {};

  for (const step of STEPS) {
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

async function run() {
  const { values } = parseArgs({
    options: { model: { type: "string" }, revision: { type: "string" } },
  });
  const packets = storyPackets(JSON.parse(await text(process.stdin)));
  const outputs = await answersOf(
    {
      "tests.json": pagedPacket(packets.test_evidence),
      "code.json": pagedPacket(packets.code_evidence),
      "issue.json": pagedPacket(packets.issue_evidence),
    },
    values.model,
  );
  const { incomplete, comment } = storyReview(outputs, storyPasses);
  const complete = incomplete.length === 0;

  console.log(
    JSON.stringify({
      status: complete ? "complete" : "incomplete",
      incomplete,
      comment: comment(
        values.revision ?? "working tree",
        complete ? "complete" : "running",
      ),
      review: formalReview(outputs),
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
