import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintPackDirectory, packLintMain } from "./pack-lint.js";

const PIPELINE_YAML = `line:
  id: acme-flow
  entry: work
  exit: done
  args:
    repo:
      kind: git
      subject: true
  nodes:
    - id: work
      station: work
      bind:
        target: repo
    - id: done
  edges:
    - from: work
      to: done
      on: success
    - from: work
      to: work
      on: failed
      iteration_max: 1
stations:
  work:
    description: Works the ticket.
    kind: agent
    agent_definition: acme-worker
    conversation: new
    outcomes:
      - success
      - failed
    result_required: true
    needs:
      - name: target
        kind: git
        path: target
    produces: []
`;

const NEW_AGENT =
  "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\nWork the ticket.\n";

function packOnDisk(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pack-lint-"));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
}

function collected() {
  const lines: string[] = [];

  return { lines, out: (line: string) => lines.push(line) };
}

describe("lintPackDirectory", () => {
  it("refuses nothing in a pack with a new pipeline folder and its new agent", async () => {
    const root = packOnDisk({
      "acme-flow/pipeline.yaml": PIPELINE_YAML,
      "acme-flow/agents/acme-worker.md": NEW_AGENT,
    });

    const report = await lintPackDirectory(root);

    expect(report).toMatchObject({
      refused: [],
      counts: { agents: 1, pipelines: 1, extensions: 0 },
    });
  });

  it("refuses an extension of an agent nothing ships, naming its path", async () => {
    const root = packOnDisk({
      "triage/agents/ghost.extra.md": "Be careful.",
    });

    const report = await lintPackDirectory(root);

    expect(report.refused.map((refusal) => refusal.path)).toEqual([
      "triage/agents/ghost.extra.md",
    ]);
  });

  it("refuses a malformed agent file and a pipeline that is not a pipeline, keeping the good file", async () => {
    const root = packOnDisk({
      "acme-flow/agents/acme-worker.md": NEW_AGENT,
      "acme-flow/agents/broken.md": "no frontmatter at all",
      "other/pipeline.yaml": "not: a pipeline",
    });

    const report = await lintPackDirectory(root);

    expect({
      refused: report.refused.map((refusal) => refusal.path).sort(),
      agents: report.counts.agents,
    }).toEqual({
      refused: ["acme-flow/agents/broken.md", "other/pipeline.yaml"],
      agents: 1,
    });
  });

  it("ignores files of the pack repository that are not pack files", async () => {
    const root = packOnDisk({
      "README.md": "# acme pack",
      ".github/workflows/lint.yml": "name: lint",
      "acme-flow/agents/acme-worker.md": NEW_AGENT,
    });

    const report = await lintPackDirectory(root);

    expect(report.refused).toEqual([]);
  });

  it("fills an environment variable a pack agent names, since the install's environment is not the linter's", async () => {
    const root = packOnDisk({
      "acme-flow/agents/acme-worker.md":
        "---\nimage: ${ACME_AGENT_IMAGE}\ntimeout_minutes: 10\n---\nWork.\n",
    });

    const report = await lintPackDirectory(root);

    expect(report.refused).toEqual([]);
  });
});

describe("packLintMain", () => {
  it("prints each refused file with its reason and exits 1", async () => {
    const root = packOnDisk({
      "triage/agents/ghost.extra.md": "Be careful.",
    });
    const { lines, out } = collected();

    const code = await packLintMain([root], out);

    expect({
      code,
      firstLine: lines[0]?.startsWith("triage/agents/ghost.extra.md: "),
    }).toEqual({
      code: 1,
      firstLine: true,
    });
  });

  it("prints what the pack supplies and exits 0 when nothing is refused", async () => {
    const root = packOnDisk({
      "acme-flow/pipeline.yaml": PIPELINE_YAML,
      "acme-flow/agents/acme-worker.md": NEW_AGENT,
    });
    const { lines, out } = collected();

    const code = await packLintMain([root], out);

    expect({ code, lines }).toEqual({
      code: 0,
      lines: ["pack ok: 1 agents, 1 pipelines, 0 extensions"],
    });
  });

  it("exits 2 and says how to call it when no directory is given", async () => {
    const { lines, out } = collected();

    const code = await packLintMain([], out);

    expect({ code, lines }).toEqual({
      code: 2,
      lines: ["usage: pack-lint <pack directory>"],
    });
  });
});
