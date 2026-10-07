import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../outbound/project/audit/audit-port.js";
import { LORE_INGEST_WORKFLOW_PATH } from "../ingest-workflow.js";
import { enrolRepo, type EnrolRepoDeps } from "./enrol-repo.js";

const TARGET = {
  repo: "re-cinq/app",
  branch: "lore/onboard/1234abcd",
  taskId: "task-1",
};

const saved = {
  url: process.env.LORE_INGEST_URL,
  token: process.env.LORE_INGEST_TOKEN,
};

beforeEach(() => {
  process.env.LORE_INGEST_URL = "https://lore.example.test";
  process.env.LORE_INGEST_TOKEN = "test-ingest-token";
});

afterEach(() => {
  restore("LORE_INGEST_URL", saved.url);
  restore("LORE_INGEST_TOKEN", saved.token);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];

    return;
  }
  process.env[name] = value;
}

function scene(overrides: Partial<EnrolRepoDeps> = {}) {
  const commits: string[] = [];
  const labels: string[] = [];
  const configured: string[] = [];
  const audited: AuditLogEntry[] = [];
  const deps: EnrolRepoDeps = {
    repo: {
      read: () => Promise.resolve(null),
      commitFile: (branch, path) => {
        commits.push(`${branch} ${path}`);

        return Promise.resolve();
      },
    },
    settings: {
      setRepoVariable: (name, value) => {
        configured.push(`${name}=${value}`);

        return Promise.resolve();
      },
      setRepoSecret: (name) => {
        configured.push(name);

        return Promise.resolve();
      },
    },
    issues: {
      createLabels: (seed) => {
        labels.push(...seed.map((label) => label.name));

        return Promise.resolve();
      },
    },
    audit: (entry) => {
      audited.push(entry);

      return Promise.resolve();
    },
    ...overrides,
  };

  return { deps, commits, labels, configured, audited };
}

describe("enrolRepo", () => {
  it("commits the ingest workflow on lore/onboard/1234abcd and reports no gap when everything lands", async () => {
    const { deps, commits } = scene();

    const enrolment = await enrolRepo(deps, TARGET);

    expect(commits).toContain(
      `lore/onboard/1234abcd ${LORE_INGEST_WORKFLOW_PATH}`,
    );
    expect(enrolment.committed).toContain(LORE_INGEST_WORKFLOW_PATH);
    expect(enrolment.attention).toBe("");
  });

  it("seeds the lore dispatch label and sets the ingest variable and secret on the repository", async () => {
    const { deps, labels, configured } = scene();

    await enrolRepo(deps, TARGET);

    expect(labels).toContain("lore");
    expect(configured).toEqual([
      "LORE_INGEST_URL=https://lore.example.test",
      "LORE_INGEST_TOKEN",
    ]);
  });

  it("hands back a needs-attention section naming the file that could not be committed, and audits it against task-1", async () => {
    const { deps, audited } = scene({
      repo: {
        read: () => Promise.resolve(null),
        commitFile: (_branch, path) =>
          path === LORE_INGEST_WORKFLOW_PATH
            ? Promise.reject(new Error("branch is protected"))
            : Promise.resolve(),
      },
    });

    const { attention } = await enrolRepo(deps, TARGET);

    expect(attention).toContain("## Needs attention");
    expect(attention).toContain(
      `- \`${LORE_INGEST_WORKFLOW_PATH}\` — branch is protected`,
    );
    expect(audited).toMatchObject([
      {
        event_type: "onboard_files_failed",
        task_id: "task-1",
        repo: "re-cinq/app",
      },
    ]);
  });

  it("reports an unset LORE_INGEST_TOKEN as a gap instead of writing an empty secret", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    const { deps, configured } = scene();

    const { attention } = await enrolRepo(deps, TARGET);

    expect(configured).toEqual(["LORE_INGEST_URL=https://lore.example.test"]);
    expect(attention).toContain("`LORE_INGEST_TOKEN` is not configured");
  });

  it("creates all eight triage:* labels on a freshly enrolled repository", async () => {
    const { deps, labels } = scene();

    await enrolRepo(deps, TARGET);

    const TRIAGE_LABELS = [
      "triage: needs-triage",
      "triage: needs-reproduction",
      "triage: reproduced",
      "triage: unable-to-reproduce",
      "triage: diagnosed",
      "triage: skipped",
      "triage: not-actionable",
      "triage: failed",
    ];

    for (const label of TRIAGE_LABELS) {
      expect(
        labels,
        `expected triage label "${label}" to be created`,
      ).toContain(label);
    }
  });
});
