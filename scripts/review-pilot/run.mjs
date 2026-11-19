import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cases } from "./cases.mjs";

const output = process.argv[2];

if (!output) {
  throw new Error(
    "Usage: node scripts/review-pilot/run.mjs /path/to/new-results.jsonl",
  );
}
await writeFile(output, "", { flag: "wx" });
const checksums = await readFile(
  new URL("./prompts/SHA256SUMS", import.meta.url),
  "utf8",
);
const prompts = {};

for (const line of checksums.trim().split("\n")) {
  const [expected, filename] = line.split(/\s+/);
  const prompt = await readFile(
    new URL(`./prompts/${filename}`, import.meta.url),
    "utf8",
  );

  if (createHash("sha256").update(prompt).digest("hex") !== expected) {
    throw new Error(`Frozen prompt mismatch: ${filename}`);
  }
  prompts[filename.slice(0, -3)] = prompt.replace(/^---\n[\s\S]+?\n---\n/, "");
}

const standardModel = process.env.PILOT_FULL_MODEL ?? "claude-sonnet-4-6";
const lightModel = process.env.PILOT_LIGHT_MODEL ?? "haiku";
const codexBaseline = process.env.PILOT_CODEX_BASELINE === "1";
const waiters = [];
let active = 0;

async function request(system, evidence, model, effort) {
  if (active >= 9) {
    await new Promise((resolve) => waiters.push(resolve));
  } else {
    active++;
  }
  const cwd = await mkdtemp(join(tmpdir(), "lore-pilot-"));
  const started = performance.now();
  let result;

  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn(
        "claude",
        [
          "-p",
          "--restricted",
          "--strict-mcp-config",
          "--tools",
          "",
          "--disable-slash-commands",
          "--no-session-persistence",
          "--max-turns",
          "1",
          "--model",
          model,
          "--effort",
          effort,
          "--output-format",
          "json",
          "--system-prompt",
          system,
        ],
        {
          cwd,
          env: {
            ...process.env,
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
            CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
          },
          timeout: 90_000,
        },
      );
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.stdin.on("error", reject);
      child.once("close", (status) => {
        if (status !== 0) {
          reject(
            new Error(
              `Claude exited ${status}: ${(stderr || stdout).slice(0, 300)}`,
            ),
          );

          return;
        }

        try {
          const response = JSON.parse(stdout);

          if (response.is_error || response.subtype !== "success") {
            throw new Error(response.result ?? "Reader returned no result");
          }
          resolve({
            text: response.result,
            model: Object.keys(response.modelUsage ?? {})[0] ?? model,
            usage: response.usage,
            cost: response.total_cost_usd,
          });
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(JSON.stringify(evidence));
    });

    return { ...result, ms: Math.round(performance.now() - started) };
  } finally {
    await rm(cwd, { recursive: true, force: true });
    const next = waiters.shift();

    if (next) {
      next();
    } else {
      active--;
    }
  }
}

async function requestCodex(system, evidence) {
  const cwd = await mkdtemp(join(tmpdir(), "lore-codex-pilot-"));
  const start = performance.now();

  try {
    const events = await new Promise((resolve, reject) => {
      const child = spawn(
        "codex",
        [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--json",
          "-m",
          "gpt-6.1-terra",
          "-c",
          'model_reasoning_effort="low"',
          "-",
        ],
        { cwd, timeout: 90_000 },
      );
      let stdout = "";

      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.resume();
      child.once("error", reject);
      child.stdin.on("error", reject);
      child.once("close", (status) => {
        if (status !== 0) {
          reject(new Error(`Codex exited ${status}`));

          return;
        }

        try {
          resolve(
            stdout
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line)),
          );
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(`${system}\n\n${JSON.stringify(evidence)}`);
    });
    const items = events.flatMap(({ type, item }) =>
      type === "item.completed" ? [item] : [],
    );

    if (
      items.some(
        ({ type }) => !["agent_message", "reasoning", "error"].includes(type),
      )
    ) {
      throw new Error("Codex used a tool during the blind replay");
    }
    const text = items
      .filter(({ type }) => type === "agent_message")
      .map(({ text }) => text)
      .join("\n");
    const usage = events.find(({ type }) => type === "turn.completed")?.usage;

    return {
      text,
      usage,
      model: "gpt-6.1-terra",
      ms: Math.round(performance.now() - start),
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const adapter =
  "This isolated replay provides each virtual /workspace file as a corresponding key in the stdin JSON. Use those bytes directly. Do not call any tools or attempt file access.";
const packets = {
  code: ["code", (file) => file.role === "code"],
  tests: ["tests", (file) => file.role === "test"],
  challenge: ["test challenge", () => true],
};

function readingResult(text) {
  const match = text.match(/\{[\s\S]+?\}\s*(?:```)?\s*LORE_NODE_RESULT/);
  const success =
    /^LORE_NODE_RESULT:\s*\{\s*"outcome"\s*:\s*"success"\s*\}\s*$/m.test(text);

  if (!match || !success) {
    return { status: "incomplete" };
  }

  try {
    return JSON.parse(match[0].slice(0, match[0].lastIndexOf("}")) + "}");
  } catch {
    return { status: "incomplete" };
  }
}

function packet(files, [mode, select]) {
  return {
    mode,
    files: files
      .filter(select)
      .map(({ path, before, after }) =>
        before === after ? { path, unchanged: after } : { path, before, after },
      ),
  };
}

async function trial(fixture, arm, repeat) {
  const started = performance.now();
  const results = {};
  const { files, discussion, specs } = fixture;
  let verdict = "incomplete";

  try {
    if (arm === "baseline" || arm === "codex-baseline") {
      const review = arm === "baseline" ? request : requestCodex;

      results.baseline = await review(
        `${prompts.baseline}\n${adapter}\nRun the same review against the supplied changed and unchanged files, discussion and base specs. Return the review and required final marker in your response in place of posting it. Include evidence and exact consequences for each blocker.`,
        { files, discussion, specs },
        standardModel,
        "medium",
      );
      const marker = results.baseline.text.match(
        /^REVIEW_RESULT:(APPROVED|CHANGES_REQUESTED)/m,
      )?.[1];

      verdict =
        marker === "APPROVED"
          ? "approve"
          : marker === "CHANGES_REQUESTED"
            ? "request_changes"
            : "incomplete";
    } else {
      const run = async (pass, prompt, material) => {
        const light = arm === "light" && (pass === "code" || pass === "tests");

        results[pass] = await request(
          prompt,
          material,
          light ? lightModel : standardModel,
          light ? "low" : "medium",
        );

        return results[pass].text;
      };
      const blind = (pass) =>
        run(pass, `${prompts[pass]}\n${prompts["reader-skill"]}\n${adapter}`, {
          "evidence.json": packet(files, packets[pass]),
        });
      const [code, tests, challenge] = await Promise.all(
        ["code", "tests", "challenge"].map(blind),
      );
      const readings = {
        "code-reading.txt": code,
        "test-reading.txt": tests,
        "intent.json": { discussion },
        "verification.json": packet(files, packets.challenge),
      };
      const intent = await run(
        "intent",
        `${prompts.intent}\n${adapter}`,
        readings,
      );
      const product = await run("product", `${prompts.product}\n${adapter}`, {
        ...readings,
        "product.json": { specs },
        "test-challenge.txt": challenge,
        "intent-comparison.txt": intent,
      });
      const passes = [code, tests, challenge, intent, product].map(
        readingResult,
      );

      if (passes.every(({ status }) => status === "complete")) {
        verdict = passes.at(-1).verdict;
      }
    }
  } catch (error) {
    results.error = { text: error.message };
  }
  const result = {
    fixture: fixture.id,
    arm,
    repeat,
    verdict,
    ms: Math.round(performance.now() - started),
    results,
  };

  await appendFile(output, `${JSON.stringify(result)}\n`);
  console.info(`${fixture.id} ${arm} ${repeat}: ${verdict}`);
}

const scheduled = cases.flatMap((fixture) =>
  [1, 2, 3].flatMap((repeat) =>
    (codexBaseline ? ["codex-baseline"] : ["full", "light", "baseline"]).map(
      (arm) => [fixture, arm, repeat],
    ),
  ),
);
let next = 0;

await Promise.allSettled(
  Array.from({ length: codexBaseline ? 3 : 9 }, async () => {
    while (next < scheduled.length) {
      await trial(...scheduled[next++]);
    }
  }),
).then((workers) => {
  for (const result of workers) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
});
