import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_VERSION,
  LORE_INGEST_WORKFLOW_CONTENT,
  ingestWorkflowStatus,
  parseIngestWorkflowVersion,
} from "./ingest-workflow.js";
import { enforceTrue } from "../lib/enforce.js";

describe("LORE_INGEST_WORKFLOW_CONTENT", () => {
  it("passes no identity token to a step in an environment variable", () => {
    const envLines = LORE_INGEST_WORKFLOW_CONTENT.split("\n").filter((line) =>
      /^\s+[A-Z][A-Z0-9_]*:/.test(line),
    );
    const names = envLines.map((line) => line.trim().split(":")[0]);

    expect(names.filter((n) => /ID_TOKEN|OIDC|IDENTITY/.test(n))).toEqual([]);
    expect(LORE_INGEST_WORKFLOW_CONTENT).not.toMatch(/ACTIONS_ID_TOKEN/);
  });

  it("targets the workflows path", () => {
    expect(LORE_INGEST_WORKFLOW_PATH).toBe(".github/workflows/lore-ingest.yml");
  });

  it("carries the current version marker on the first line", () => {
    expect(
      LORE_INGEST_WORKFLOW_CONTENT.startsWith(
        `# lore-ingest-version: ${LORE_INGEST_WORKFLOW_VERSION}\n`,
      ),
    ).toBe(true);
  });

  it("exposes FILES as a step-level env var, not inside the run block", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      "FILES: ${{ steps.changes.outputs.files }}",
    );
  });

  it("sends a literal-escaped JSON body referencing the FILES env var", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain('\\"files\\": ${FILES}');
  });

  it("posts to the ingest endpoint without a self-referential url fallback", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      '"${LORE_INGEST_URL}/api/ingest"',
    );
    expect(LORE_INGEST_WORKFLOW_CONTENT).not.toContain("LORE_INGEST_URL:-");
  });

  it("keeps the secret wiring and reads the URL from a secret before the vars fallback", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      "LORE_INGEST_TOKEN: ${{ secrets.LORE_INGEST_TOKEN }}",
    );
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      "LORE_INGEST_URL: ${{ secrets.LORE_INGEST_URL || vars.LORE_INGEST_URL || vars.LORE_API_URL }}",
    );
  });

  it("is version 10 — the template a workflow_dispatch run can start a first ingestion from", () => {
    expect(LORE_INGEST_WORKFLOW_VERSION).toBe(10);
  });

  it("triggers on workflow_dispatch beside the push to main", () => {
    expect(triggerBlock()).toContain("\n  workflow_dispatch:\n");
    expect(triggerBlock()).toContain("\n  push:\n    branches: [main]\n");
  });

  it("lists with git ls-files exactly the pathspecs the push filter names", () => {
    const pushPaths = [...triggerBlock().matchAll(/^ {6}- '(.+)'$/gm)].map(
      (match) => match[1],
    );
    const lsFilesPathspecs = extractRunBlock("Get changed files").match(
      /git ls-files -- ([^|]+) \|/,
    )?.[1];

    expect(lsFilesPathspecs).toEqual(
      pushPaths.map((path) => `'${path}'`).join(" "),
    );
  });

  it("projects specs and ADRs with lore-code-trace docs --post and no longer posts to ingest-graph", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      "./lore-code-trace docs --post",
    );
    expect(LORE_INGEST_WORKFLOW_CONTENT).not.toContain("ingest-graph");
  });

  it("checks out the full history for the graph job, since the delta is a diff against the last ingested commit", () => {
    expect(graphJob()).toContain("fetch-depth: 0");
  });

  it("verifies the binary against its checksum before making it executable", () => {
    const job = graphJob();

    expect(job.indexOf("sha256sum -c -")).toBeGreaterThan(-1);
    expect(job.indexOf("sha256sum -c -")).toBeLessThan(
      job.indexOf("chmod +x lore-code-trace"),
    );
  });

  it("proves the served binary has the docs subcommand before posting", () => {
    const run = extractRunBlock("Project specs and ADRs into the graph");

    expect(run.indexOf("./lore-code-trace docs |")).toBeLessThan(
      run.indexOf("./lore-code-trace docs --post"),
    );
  });

  it("probes for the docs subcommand without grep -q, which would kill a writer still printing under pipefail", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      `./lore-code-trace docs | grep '"specs"' > /dev/null`,
    );
    expect(LORE_INGEST_WORKFLOW_CONTENT).not.toContain("grep -q");
  });

  it("lists changed files with --no-renames so a renamed file arrives as a delete plus an add", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      "git diff --name-only --no-renames HEAD~1 HEAD",
    );
  });

  it("keeps the reference copy in scripts/onboarding-templates in sync with the constant", () => {
    let dir = process.cwd();

    while (!existsSync(join(dir, "scripts", "onboarding-templates"))) {
      const parent = dirname(dir);

      enforceTrue(
        parent !== dir,
        Error,
        "repo root with scripts/onboarding-templates not found",
      );
      dir = parent;
    }
    const referenceCopy = readFileSync(
      join(
        dir,
        "scripts",
        "onboarding-templates",
        ".github",
        "workflows",
        "lore-ingest.yml",
      ),
      "utf8",
    );
    const [marker, ...rest] = LORE_INGEST_WORKFLOW_CONTENT.split("\n");
    const expected = [
      marker,
      "# Canonical source: shared/src/ingest-workflow.ts (LORE_INGEST_WORKFLOW_CONTENT).",
      "# This file is reference-only; the agent installs the workflow from that constant.",
      ...rest,
    ].join("\n");

    expect(referenceCopy).toBe(expected);
  });
});

function triggerBlock(): string {
  return LORE_INGEST_WORKFLOW_CONTENT.slice(
    LORE_INGEST_WORKFLOW_CONTENT.indexOf("\non:\n"),
    LORE_INGEST_WORKFLOW_CONTENT.indexOf("\njobs:\n"),
  );
}

function graphJob(): string {
  return LORE_INGEST_WORKFLOW_CONTENT.slice(
    LORE_INGEST_WORKFLOW_CONTENT.indexOf("\n  graph:\n"),
  );
}

function extractRunBlock(stepName: string): string {
  const lines = LORE_INGEST_WORKFLOW_CONTENT.split("\n");
  const stepIndex = lines.findIndex(
    (line) => line.trim() === `- name: ${stepName}`,
  );

  enforceTrue(
    stepIndex !== -1,
    Error,
    `step not found in workflow template: ${stepName}`,
  );
  const runIndex = lines.findIndex(
    (line, index) => index > stepIndex && line.trim() === "run: |",
  );

  enforceTrue(
    runIndex !== -1,
    Error,
    `run block not found for step: ${stepName}`,
  );
  const body: string[] = [];

  for (const line of lines.slice(runIndex + 1)) {
    if (line !== "" && !line.startsWith("          ")) {
      break;
    }
    body.push(line.slice(10));
  }

  return body
    .join("\n")
    .replaceAll("${{ github.repository }}", "re-cinq/example")
    .replaceAll("${{ github.sha }}", "f".repeat(40))
    .replaceAll("${{ matrix.kind }}", "specs");
}

const curlStub = `#!/usr/bin/env bash
if [ -n "\${CURL_STUB_ARGS:-}" ]; then printf '%s\\n' "$@" > "\${CURL_STUB_ARGS}"; fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then out="$arg"; fi
  prev="$arg"
done
if [ -n "$out" ]; then printf '%s' "\${CURL_STUB_BODY:-}" > "$out"; fi
printf '%s' "\${CURL_STUB_STATUS:-000}"
exit "\${CURL_STUB_EXIT:-0}"
`;

const loreCodeTraceStub = `#!/usr/bin/env bash
if [ "$1" = "docs" ] && [ "$2" != "--post" ]; then
  printf '"specs"\\n'
  exit 0
fi
exit "\${LORE_CODE_TRACE_POST_EXIT:-0}"
`;

const runScript = (script: string, env: Record<string, string>) => {
  const workDir = mkdtempSync(join(tmpdir(), "lore-ingest-test-"));
  const scriptPath = join(workDir, "step.sh");
  const stubPath = join(workDir, "curl");
  const loreCodeTracePath = join(workDir, "lore-code-trace");

  writeFileSync(scriptPath, script);
  writeFileSync(stubPath, curlStub);
  chmodSync(stubPath, 0o755);

  if ("LORE_CODE_TRACE_POST_EXIT" in env) {
    writeFileSync(loreCodeTracePath, loreCodeTraceStub);
    chmodSync(loreCodeTracePath, 0o755);
  }

  return {
    workDir,
    result: spawnSync("bash", ["-e", scriptPath], {
      encoding: "utf8",
      cwd: workDir,
      env: {
        PATH: `${workDir}:${process.env.PATH}`,
        TMPDIR: workDir,
        FILES: '["README.md"]',
        LORE_INGEST_URL: "https://lore-ingest.example.test",
        LORE_INGEST_TOKEN: "test-ingest-token",
        ...env,
      },
    }),
  };
};

describe("the ingest job's changed-files step", () => {
  const script = extractRunBlock("Get changed files");

  const filesOutputOf = (eventName: string): unknown[] => {
    const repoDir = mkdtempSync(join(tmpdir(), "lore-ingest-repo-"));
    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: repoDir,
        encoding: "utf8",
      });

    git("init", "-q");
    mkdirSync(join(repoDir, "specs"));
    mkdirSync(join(repoDir, "src"));
    writeFileSync(join(repoDir, "CLAUDE.md"), "one");
    writeFileSync(join(repoDir, "specs", "old.md"), "one");
    writeFileSync(join(repoDir, "src", "code.ts"), "one");
    git("add", ".");
    git("commit", "-q", "-m", "first");
    writeFileSync(join(repoDir, "specs", "new.md"), "two");
    git("add", ".");
    git("commit", "-q", "-m", "second");
    const outputFile = join(repoDir, "github-output.txt");

    writeFileSync(outputFile, "");
    const stepResult = spawnSync("bash", ["-e", "-c", script], {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        GITHUB_EVENT_NAME: eventName,
        GITHUB_OUTPUT: outputFile,
      },
    });

    expect(stepResult.status).toBe(0);

    return JSON.parse(
      readFileSync(outputFile, "utf8")
        .replace(/^files=/, "")
        .trim(),
    );
  };

  it("lists only the files of the last commit on a push", () => {
    expect(filesOutputOf("push")).toEqual(["specs/new.md"]);
  });

  it("lists every tracked file under the push paths on a workflow_dispatch, none outside them", () => {
    expect(filesOutputOf("workflow_dispatch").sort()).toEqual([
      "CLAUDE.md",
      "specs/new.md",
      "specs/old.md",
    ]);
  });
});

describe("the graph job's fetch step", () => {
  const script = extractRunBlock("Fetch lore-code-trace");

  it("fails before fetching, with ::error, when LORE_INGEST_URL is empty", () => {
    const { result } = runScript(script, { LORE_INGEST_URL: "" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::LORE_INGEST_URL");
  });

  it("fails before fetching, with ::error, when LORE_INGEST_TOKEN is empty", () => {
    const { result } = runScript(script, { LORE_INGEST_TOKEN: "" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::LORE_INGEST_TOKEN");
  });

  it("exits 0 with ::warning and leaves no binary behind when Lore cannot be reached", () => {
    const { result, workDir } = runScript(script, { CURL_STUB_EXIT: "22" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::");
    expect(existsSync(join(workDir, "lore-code-trace"))).toBe(false);
  });

  it("fails and leaves no executable when the binary does not match its checksum", () => {
    const { result, workDir } = runScript(script, {
      CURL_STUB_BODY: "not a checksum list",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(workDir, "lore-code-trace"))).toBe(false);
  });
});

describe("the ingest job's run block", () => {
  const script = extractRunBlock("Notify Lore to ingest");

  it("exits 1 with ::error when LORE_INGEST_URL is empty", () => {
    const { result } = runScript(script, { LORE_INGEST_URL: "" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::LORE_INGEST_URL");
  });

  it("exits 1 with ::error when LORE_INGEST_TOKEN is empty", () => {
    const { result } = runScript(script, { LORE_INGEST_TOKEN: "" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::LORE_INGEST_TOKEN");
  });

  it("exits 0 and prints HTTP 200 on success without warnings or errors", () => {
    const { result } = runScript(script, { CURL_STUB_STATUS: "200" });

    expect(result).toMatchObject({ status: 0 });
    expect(result.stdout).toMatch(/^(?!.*::(warning|error)).*HTTP 200/s);
  });

  it("exits 1 with ::error and prints the response body on HTTP 401", () => {
    const { result } = runScript(script, {
      CURL_STUB_STATUS: "401",
      CURL_STUB_BODY: '{"error":"unauthorized"}',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(
      /^(?=[\s\S]*^::error::)(?=[\s\S]*401)(?=[\s\S]*unauthorized)/m,
    );
  });

  it("exits 1 with ::error on an HTTP 308 redirect", () => {
    const { result } = runScript(script, { CURL_STUB_STATUS: "308" });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error::/m);
    expect(result.stdout).toContain("308");
  });

  it("exits 0 with ::warning on HTTP 503", () => {
    const { result } = runScript(script, { CURL_STUB_STATUS: "503" });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^::warning::/m);
    expect(result.stdout).toContain("503");
  });

  it("exits 0 with ::warning on HTTP 429 from the shared rate-limit bucket", () => {
    const { result } = runScript(script, { CURL_STUB_STATUS: "429" });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^::warning::/m);
    expect(result.stdout).toContain("429");
  });

  it("exits 0 with ::warning on connection-refused curl exit 7", () => {
    const { result } = runScript(script, {
      CURL_STUB_STATUS: "000",
      CURL_STUB_EXIT: "7",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^::warning::/m);
    expect(result.stdout).toContain("curl exit 7");
  });

  it("exits 1 with ::error on unresolvable-host curl exit 6", () => {
    const { result } = runScript(script, {
      CURL_STUB_STATUS: "000",
      CURL_STUB_EXIT: "6",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error::/m);
    expect(result.stdout).toContain("exit 6");
  });

  it("exits 1 with ::error on malformed-URL curl exit 3", () => {
    const { result } = runScript(script, {
      CURL_STUB_STATUS: "000",
      CURL_STUB_EXIT: "3",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error::/m);
    expect(result.stdout).toContain("exit 3");
  });

  it("prefixes the response body so it cannot forge a workflow command even after TrimStart", () => {
    const { result } = runScript(script, {
      CURL_STUB_STATUS: "200",
      CURL_STUB_BODY: "::error::forged from the response body",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| ::error::forged");
    expect(result.stdout).not.toMatch(/^::error::/m);
  });

  it("never passes the bearer token on the curl command line", () => {
    const workDir = mkdtempSync(join(tmpdir(), "lore-ingest-args-"));
    const argsFile = join(workDir, "curl-args.txt");
    const { result } = runScript(script, {
      CURL_STUB_STATUS: "200",
      CURL_STUB_ARGS: argsFile,
    });

    expect(result.status).toBe(0);
    const argv = readFileSync(argsFile, "utf8");

    expect(argv).not.toContain("test-ingest-token");
    expect(argv).toMatch(/^@/m);
  });
});

describe("the graph job's projection step", () => {
  const script = extractRunBlock("Project specs and ADRs into the graph");

  it("exits 0 with ::warning when lore-code-trace exits 75", () => {
    const { result } = runScript(script, { LORE_CODE_TRACE_POST_EXIT: "75" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::");
    expect(result.stdout).toContain("projection will retry on next doc push");
  });
});

describe("parseIngestWorkflowVersion", () => {
  it("reads the version from the marker line", () => {
    expect(
      parseIngestWorkflowVersion("# lore-ingest-version: 7\nname: x"),
    ).toBe(7);
  });

  it("returns null when no marker is present", () => {
    expect(
      parseIngestWorkflowVersion("name: Lore Context Ingest\non: push"),
    ).toBeNull();
  });
});

describe("ingestWorkflowStatus", () => {
  it("returns missing when the file is absent", () => {
    expect(ingestWorkflowStatus(null)).toBe("missing");
  });

  it("returns stale when the file has no version marker (legacy broken install)", () => {
    expect(ingestWorkflowStatus("name: Lore Context Ingest\non: push")).toBe(
      "stale",
    );
  });

  it("returns stale when the marker version is older than current", () => {
    expect(
      ingestWorkflowStatus(
        `# lore-ingest-version: ${LORE_INGEST_WORKFLOW_VERSION - 1}\n`,
      ),
    ).toBe("stale");
  });

  it("returns aligned for the canonical content", () => {
    expect(ingestWorkflowStatus(LORE_INGEST_WORKFLOW_CONTENT)).toBe("aligned");
  });

  it("returns aligned when the marker version is newer than current", () => {
    expect(
      ingestWorkflowStatus(
        `# lore-ingest-version: ${LORE_INGEST_WORKFLOW_VERSION + 1}\n`,
      ),
    ).toBe("aligned");
  });
});

describe("the graph job's fetch retries", () => {
  const script = extractRunBlock("Fetch lore-code-trace");

  it("asks curl for 7 attempts 30 seconds apart, retrying any error, and gives each connect 20 seconds", () => {
    const argsFile = join(mkdtempSync(join(tmpdir(), "curl-args-")), "args");

    runScript(script, { CURL_STUB_EXIT: "22", CURL_STUB_ARGS: argsFile });
    const args = readFileSync(argsFile, "utf8").trim().split("\n");
    const start = args.indexOf("--connect-timeout");

    expect(args.slice(start, start + 7)).toEqual([
      "--connect-timeout",
      "20",
      "--retry",
      "6",
      "--retry-delay",
      "30",
      "--retry-all-errors",
    ]);
  });
});
