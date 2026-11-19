import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { z } from "zod";
import { floorClientFrom } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  fileItem,
  floorRepoOf,
  parsePullRequestUrl,
  pullRequestUrl,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { isTestFile } from "../libs/shared/dist/domain/test-paths.js";

const modes = ["code", "tests", "test challenge"];
const shadowEvidence = [
  "code_evidence",
  "test_evidence",
  "challenge_evidence",
  "intent_evidence",
  "product_evidence",
];
const snapshot = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      role: z.enum(["code", "test"]),
      before: z.string().nullable(),
      after: z.string().nullable(),
    }),
  ),
  discussion: z
    .array(
      z.object({
        source: z.enum([
          "pull_request",
          "issue",
          "issue_comment",
          "pull_request_comment",
          "review_thread",
        ]),
        url: z.url(),
        author: z.string().optional(),
        text: z.string(),
      }),
    )
    .default([]),
  specs: z
    .array(
      z.object({
        path: z.string().min(1),
        text: z.string(),
        version: z.enum(["existing", "proposed"]).default("existing"),
      }),
    )
    .default([]),
  documents: z
    .array(
      z.object({
        path: z.string().min(1),
        before: z.string().nullable(),
        after: z.string().nullable(),
      }),
    )
    .optional(),
});

function packetFor(mode, files) {
  const selected = [];

  for (const file of files) {
    if (/\.(md|mdx|markdown|mkd|mkdn|mdown)$/i.test(file.path)) {
      continue;
    }
    const test =
      file.role === "test" ||
      isTestFile(file.path) ||
      /(?:^|\/)(?:tests?|__mocks__|__fixtures__)\//i.test(file.path);

    if ((mode === "code" && test) || (mode === "tests" && !test)) {
      continue;
    }
    selected.push(
      file.before === file.after
        ? { path: file.path, unchanged: file.after }
        : { path: file.path, before: file.before, after: file.after },
    );
  }

  return { mode, files: selected };
}

async function previousAutomaticRun(floor, repo, reviewKey, preparationFailed) {
  let cursor;

  do {
    const page = await floor.runs.list(
      { repo, line: "code-review-shadow", subject: `review_key:${reviewKey}` },
      { cursor },
    );
    const prior = page.items.find(
      ({ startItems }) =>
        startItems.automatic?.ref === "true" &&
        (preparationFailed || startItems.preparation_failed?.ref !== "true"),
    );

    if (prior) {
      return prior;
    }
    cursor = page.nextCursor;
  } while (cursor);

  return null;
}

async function startShadow(revision, requestedPrUrl, automatic, evidence) {
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("Use the full GitHub commit SHA for --shadow-revision");
  }
  const target =
    requestedPrUrl === undefined
      ? undefined
      : parsePullRequestUrl(requestedPrUrl);
  const repo = target && floorRepoOf(target.repo);
  const prUrl =
    target && pullRequestUrl(target.repo.toLowerCase(), target.prNumber);
  const reviewKey = prUrl === undefined ? revision : `${prUrl}@${revision}`;
  const floor = floorClientFrom(process.env);
  const preparationFailed = evidence === undefined;

  if (automatic) {
    const prior = await previousAutomaticRun(
      floor,
      repo,
      reviewKey,
      preparationFailed,
    );

    if (prior) {
      return { status: "shadow_started", runId: prior.id, revision };
    }
  }
  const files = await shadowFiles(floor, evidence);
  const startItems = {
    review_key: valueItem(reviewKey),
    revision: valueItem(revision),
    ...(prUrl === undefined ? {} : { pr_url: valueItem(prUrl) }),
    ...(automatic ? { automatic: valueItem("true") } : {}),
    ...(preparationFailed ? { preparation_failed: valueItem("true") } : {}),
    ...files,
  };
  const { run } = await floor.lines.start("code-review-shadow", {
    ...(repo === undefined ? {} : { repo }),
    ...(preparationFailed ? { entry: "publish-incomplete" } : {}),
    startItems,
  });

  return { status: "shadow_started", runId: run.id, revision };
}

async function shadowFiles(floor, evidence) {
  const upload = async (packet) => {
    const { hash } = await floor.blobs.put(
      Buffer.from(JSON.stringify(packet)),
      "application/json",
    );

    return fileItem(hash);
  };

  if (evidence === undefined) {
    const placeholder = await upload({});

    return Object.fromEntries(
      shadowEvidence.map((name) => [name, placeholder]),
    );
  }

  return Object.fromEntries(
    await Promise.all(
      shadowEvidence.map(async (name, index) => [
        name,
        await upload(evidence[index]),
      ]),
    ),
  );
}

function invokeReader(args, packet, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      args,
      {
        cwd,
        timeout: 180_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          PWD: cwd,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
          CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail =
            stderr.trim().split("\n")[0] || "no diagnostic from the CLI";

          reject(
            new Error(
              `Claude reader failed (${error.signal ?? error.code}): ${detail.slice(0, 300)}`,
            ),
          );

          return;
        }
        resolve(stdout);
      },
    );

    child.stdin.on("error", reject);
    child.stdin.end(JSON.stringify(packet));
  });
}

async function readPass(packet, instructions, options) {
  const { mode } = packet;
  const cwd = await mkdtemp(join(tmpdir(), "lore-reader-"));

  try {
    const statements = z.array(z.string().regex(/\S/));
    const response = z.object({
      status: z.enum(["complete", "incomplete"]),
      reading: mode === "code" ? statements.length(2) : statements.min(1),
      evidence: z.array(z.string()),
      requests: z.array(z.string()),
    });
    const args = [
      "-p",
      "--restricted",
      "--strict-mcp-config",
      "--tools",
      "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--system-prompt",
      instructions,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(z.toJSONSchema(response, { target: "draft-7" })),
    ];

    if (mode !== "test challenge") {
      if (options["reader-model"]) {
        args.push("--model", options["reader-model"]);
      }

      if (options["reader-effort"]) {
        args.push("--effort", options["reader-effort"]);
      }
    }
    const stdout = await invokeReader(args, packet, cwd);
    const result = JSON.parse(stdout);

    if (result.subtype !== "success" || result.is_error !== false) {
      throw new Error("Reader returned no successful reading");
    }

    return { mode, ...response.parse(result.structured_output) };
  } catch (error) {
    return { mode, status: "incomplete", reason: error.message };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function run() {
  const { values } = parseArgs({
    options: {
      "reader-model": { type: "string" },
      "reader-effort": { type: "string" },
      "shadow-revision": { type: "string" },
      "shadow-pr-url": { type: "string" },
      "shadow-incomplete": { type: "boolean" },
      automatic: { type: "boolean" },
    },
  });
  const revision = values["shadow-revision"];
  const prUrl = values["shadow-pr-url"];
  const incomplete = values["shadow-incomplete"];

  if ((values.automatic || incomplete) && (!revision || !prUrl)) {
    throw new Error(
      `${incomplete ? "--shadow-incomplete" : "--automatic"} requires --shadow-revision and --shadow-pr-url`,
    );
  }

  if (incomplete) {
    console.log(
      JSON.stringify(await startShadow(revision, prUrl, values.automatic)),
    );

    return;
  }
  const { files, discussion, specs, documents } = snapshot.parse(
    JSON.parse(await text(process.stdin)),
  );

  for (const file of files) {
    if (file.role === "test" || isTestFile(file.path)) {
      continue;
    }
    const inlineTests = [file.before, file.after].some(
      (source) =>
        source &&
        (isTestFile(file.path, source) ||
          (file.path.endsWith(".rs") && /#\[cfg\(test\)\]/.test(source)) ||
          (/\.[cm]?[jt]sx?$/.test(file.path) &&
            /\bimport\.meta\.vitest\b/.test(source))),
    );

    if (inlineTests) {
      throw new Error(
        `Separate the code and inline test regions in ${file.path}`,
      );
    }
  }
  const packets = modes.map((mode) => packetFor(mode, files));

  if (revision !== undefined) {
    if (values["reader-model"] || values["reader-effort"]) {
      throw new Error("Hosted reader models are configured on the floor");
    }
    console.log(
      JSON.stringify(
        await startShadow(revision, prUrl, values.automatic, [
          ...packets,
          { mode: "intent", discussion },
          {
            mode: "product",
            specs,
            ...(documents?.length ? { documents } : {}),
          },
        ]),
      ),
    );

    return;
  }

  if (prUrl !== undefined) {
    throw new Error("--shadow-pr-url requires --shadow-revision");
  }
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const skillFile = join(configDir, "skills", "lore-review-files", "SKILL.md");
  const instructions = await readFile(skillFile, "utf8");
  const readings = await Promise.all(
    packets.map((packet) => readPass(packet, instructions, values)),
  );
  const complete = readings.every((reading) => reading.status === "complete");

  console.log(
    JSON.stringify({
      status: complete ? "readings_complete" : "incomplete",
      readings,
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
