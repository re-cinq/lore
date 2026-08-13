// Opening + recording the PR a `push` node produced.
//
// Nothing did this. The push recipe ends "commit it, and stop. The watcher opens
// the PR" — and the watcher returns early for every assembly-line node CR, so on
// the merged planning line no spec PR was ever opened, `lore.features.spec_pr_url`
// stayed null, and the feature never left the planning phase. `findOpenByPr` also
// reads `args->>'pr_number'`, so a line whose PR was never stamped cannot be found
// when that PR merges.

import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import { InMemoryFeatures } from "@re-cinq/lore-shared/project/features/features-memory.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { decidePrStamp, stampLinePr, type SpecPrPorts } from "./spec-pr.js";

const REPO = "re-cinq/lore";

/** A PR surface that records what it was asked to open, so a test can assert the
 *  line was NOT given a second PR for a branch that already has one. */
class FakePulls {
  readonly opened: { branch: string; title: string; body: string }[] = [];

  constructor(private readonly existing: PullRef[] = []) {}

  async list(): Promise<PullRef[]> {
    return this.existing;
  }

  async open(branch: string, title: string, body: string): Promise<PullRef> {
    this.opened.push({ branch, title, body });

    const pr: PullRef = {
      repo: REPO,
      number: 4200 + this.opened.length,
      title,
      branch,
      state: "open",
      labels: [],
      url: `https://github.com/${REPO}/pull/${4200 + this.opened.length}`,
    };

    this.existing.push(pr);

    return pr;
  }
}

const pullRef = (branch: string, number: number): PullRef => ({
  repo: REPO,
  number,
  title: `spec: ${branch}`,
  branch,
  state: "open",
  labels: [],
  url: `https://github.com/${REPO}/pull/${number}`,
});

interface Harness {
  ports: SpecPrPorts;
  lines: InMemoryAssemblyLines;
  features: InMemoryFeatures;
  pulls: FakePulls;
  lineId: string;
  featureId: string;
}

async function harness(
  options: { existingPulls?: PullRef[]; withFeature?: boolean } = {},
): Promise<Harness> {
  const lines = new InMemoryAssemblyLines();
  const features = new InMemoryFeatures();
  const pulls = new FakePulls(options.existingPulls ?? []);
  const feature = await features.create(REPO, {
    title: "Dark factory rollback",
    prompt: "Make rollback one command",
  });
  const lineId = await lines.start({
    definitionName: "feature-planning",
    repo: REPO,
    branch: "feature/dark-factory-rollback",
    args: options.withFeature === false ? {} : { feature_id: feature.id },
  });

  return {
    lines,
    features,
    pulls,
    lineId,
    featureId: feature.id,
    ports: {
      pulls,
      assemblyLines: lines,
      // Production passes `project.features`, which is already repo-bound; the
      // in-memory double is the raw port, so the test binds the repo the same way.
      features: {
        get: (id) => features.get(REPO, id),
        transitionStatus: (id, status, patch) =>
          features.transitionStatus(REPO, id, status, patch),
      },
    },
  };
}

describe("decidePrStamp", () => {
  const base = {
    promptRef: "push-only",
    outcome: "success",
    args: {} as Record<string, unknown>,
  };

  it("stamps when a push node succeeds on a line with no PR yet", () => {
    expect(decidePrStamp(base)).toBe(true);
  });

  it("does not stamp a node that is not the push node", () => {
    expect(decidePrStamp({ ...base, promptRef: "feature-planning" })).toBe(
      false,
    );
  });

  it("does not stamp a node with no prompt_ref at all", () => {
    expect(decidePrStamp({ ...base, promptRef: undefined })).toBe(false);
  });

  it("does not stamp a push node that failed", () => {
    expect(decidePrStamp({ ...base, outcome: "failed" })).toBe(false);
  });

  it("does not stamp a push node whose outcome is not recorded yet", () => {
    expect(decidePrStamp({ ...base, outcome: null })).toBe(false);
  });

  it("does not stamp a line that already carries a PR number", () => {
    // Re-running push after an objection must not mint a second PR for the branch.
    expect(decidePrStamp({ ...base, args: { pr_number: 17 } })).toBe(false);
  });
});

describe("stampLinePr", () => {
  it("opens a PR for the line's branch and records it on the line", async () => {
    const h = await harness();

    await stampLinePr(await lineRow(h), h.ports);

    expect(h.pulls.opened).toEqual([
      {
        branch: "feature/dark-factory-rollback",
        title: "spec: Dark factory rollback",
        body: expect.stringContaining("dark-factory-rollback"),
      },
    ]);
    expect((await h.lines.getById(h.lineId))?.args).toMatchObject({
      pr_number: 4201,
      pr_url: `https://github.com/${REPO}/pull/4201`,
    });
  });

  it("reuses the open PR the branch already has", async () => {
    // The push node re-runs after a write/analyse correction. A second PR for the
    // same branch would split the review and orphan the first.
    const h = await harness({
      existingPulls: [pullRef("feature/dark-factory-rollback", 99)],
    });

    await stampLinePr(await lineRow(h), h.ports);

    expect(h.pulls.opened).toEqual([]);
    expect((await h.lines.getById(h.lineId))?.args).toMatchObject({
      pr_number: 99,
    });
  });

  it("ignores an open PR for a different branch", async () => {
    const h = await harness({
      existingPulls: [pullRef("feature/something-else", 7)],
    });

    await stampLinePr(await lineRow(h), h.ports);

    expect((await h.lines.getById(h.lineId))?.args).toMatchObject({
      pr_number: 4201,
    });
  });

  it("moves the feature to pr-open carrying the spec PR and path", async () => {
    const h = await harness();

    await stampLinePr(await lineRow(h), h.ports);

    expect(await h.features.get(REPO, h.featureId)).toMatchObject({
      status: "pr-open",
      spec_pr_number: 4201,
      spec_pr_url: `https://github.com/${REPO}/pull/4201`,
      spec_path: "specs/dark-factory-rollback/spec.md",
    });
  });

  it("still records the PR on a line that carries no feature", async () => {
    // Every line with a push node stamps its PR — that is what lets findOpenByPr
    // resolve it later. Only the feature transition is feature-specific.
    const h = await harness({ withFeature: false });

    await stampLinePr(await lineRow(h), h.ports);

    expect((await h.lines.getById(h.lineId))?.args).toMatchObject({
      pr_number: 4201,
    });
  });

  it("records the PR even when the feature transition throws", async () => {
    // The stamp is what makes the merge findable; losing it because the feature
    // write failed would strand the line at the merged node forever. Ordering, not
    // just error handling: the stamp must already be committed when this throws.
    const h = await harness();

    await stampLinePr(await lineRow(h), {
      ...h.ports,
      features: {
        get: h.ports.features.get,
        transitionStatus: async () => {
          throw new Error("features table unavailable");
        },
      },
    });

    expect((await h.lines.getById(h.lineId))?.args).toMatchObject({
      pr_number: 4201,
    });
  });

  it("skips a line that has no branch to open a PR from", async () => {
    const h = await harness();
    const row = await lineRow(h);

    await stampLinePr({ ...row, branch: null }, h.ports);

    expect(h.pulls.opened).toEqual([]);
    expect((await h.lines.getById(h.lineId))?.args.pr_number).toBeUndefined();
  });

  it("skips a feature the line names but the repo no longer has", async () => {
    // A deleted feature must not stop the PR being recorded.
    const h = await harness();
    const row = await lineRow(h);

    await stampLinePr(
      { ...row, args: { ...row.args, feature_id: "no-such-feature" } },
      h.ports,
    );

    expect((await h.lines.getById(h.lineId))?.args).toMatchObject({
      pr_number: 4201,
    });
  });
});

async function lineRow(h: Harness) {
  const row = await h.lines.getById(h.lineId);

  enforceTrue(row !== null, Error, "line row missing");

  return row;
}
