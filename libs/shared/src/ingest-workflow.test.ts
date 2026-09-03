import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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
import { enforceTrue } from "./lib/enforce.js";

describe("LORE_INGEST_WORKFLOW_CONTENT", () => {
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

  it("keeps the secret wiring and reads the URL with the LORE_API_URL fallback the sibling template uses", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      "LORE_INGEST_TOKEN: ${{ secrets.LORE_INGEST_TOKEN }}",
    );
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain(
      "LORE_INGEST_URL: ${{ vars.LORE_INGEST_URL || vars.LORE_API_URL }}",
    );
  });

  it("is version 4 — the hardened error-handling template", () => {
    expect(LORE_INGEST_WORKFLOW_VERSION).toBe(4);
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

const extractRunBlock = (stepName: string): string => {
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
};

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

const runScript = (script: string, env: Record<string, string>) => {
  const workDir = mkdtempSync(join(tmpdir(), "lore-ingest-test-"));
  const scriptPath = join(workDir, "step.sh");
  const stubPath = join(workDir, "curl");

  writeFileSync(scriptPath, script);
  writeFileSync(stubPath, curlStub);
  chmodSync(stubPath, 0o755);

  return {
    workDir,
    result: spawnSync("bash", ["-e", scriptPath], {
      encoding: "utf8",
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

describe.each([
  ["ingest", "Notify Lore to ingest"],
  ["graph", "Project ${{ matrix.kind }} into the graph"],
])("%s run block", (_jobName, stepName) => {
  const script = extractRunBlock(stepName);

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

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("HTTP 200");
    expect(result.stdout).not.toContain("::warning");
    expect(result.stdout).not.toContain("::error");
  });

  it("exits 1 with ::error and prints the response body on HTTP 401", () => {
    const { result } = runScript(script, {
      CURL_STUB_STATUS: "401",
      CURL_STUB_BODY: '{"error":"unauthorized"}',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error::/m);
    expect(result.stdout).toContain("401");
    expect(result.stdout).toContain("unauthorized");
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
