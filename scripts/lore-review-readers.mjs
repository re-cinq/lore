import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { z } from "zod";
import { floorClientFrom } from "@re-cinq/lore-shared/floor/floor-client.js";
import { fileItem, valueItem } from "@re-cinq/lore-shared/floor/floor-items.js";
import { isTestFile } from "../libs/shared/dist/domain/test-paths.js";

const modes = ["code", "tests", "test challenge"];
const shadowInputs = ["code_evidence", "test_evidence", "challenge_evidence"];
const snapshot = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      role: z.enum(["code", "test"]),
      before: z.string().nullable(),
      after: z.string().nullable(),
    }),
  ),
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

async function startShadow(revision, packets) {
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("Use the full GitHub commit SHA for --shadow-revision");
  }
  const floor = floorClientFrom(process.env);
  const blobs = await Promise.all(
    packets.map((packet) =>
      floor.blobs.put(Buffer.from(JSON.stringify(packet)), "application/json"),
    ),
  );
  const startItems = { revision: valueItem(revision) };

  for (const [index, name] of shadowInputs.entries()) {
    startItems[name] = fileItem(blobs[index].hash);
  }
  const { run } = await floor.lines.start("code-review-shadow", { startItems });

  return { status: "shadow_started", runId: run.id, revision };
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
    },
  });
  const { files } = snapshot.parse(JSON.parse(await text(process.stdin)));

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

  if (values["shadow-revision"] !== undefined) {
    if (values["reader-model"] || values["reader-effort"]) {
      throw new Error("Hosted reader models are configured on the floor");
    }
    console.log(
      JSON.stringify(await startShadow(values["shadow-revision"], packets)),
    );

    return;
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
