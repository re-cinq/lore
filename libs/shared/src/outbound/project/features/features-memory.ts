import { randomUUID } from "node:crypto";
import { enforceTrue } from "../../../lib/enforce.js";
import type { IterationResult } from "./features-port.js";
import {
  PATCH_COLUMNS,
  slugifyFeatureTitle,
  type FeaturesPort,
  type Feature,
  type FeatureIteration,
  type FeatureWithIterations,
  type FeatureStatus,
  type CreateFeatureInput,
  type FeaturePatch,
} from "./features-port.js";

/** The identity and content columns the caller's input decides. */
function featureContent(input: CreateFeatureInput, slug: string) {
  return {
    id: randomUUID(),
    title: input.title,
    slug,
    path: `specs/${slug}`,
    original_prompt: input.prompt,
    status: "draft" as const,
    created_by: input.createdBy ?? "ui",
  };
}

/** The columns a fresh draft leaves at the Pg INSERT's own defaults. */
function featureDefaults() {
  return {
    current_iteration: 0,
    draft_spec_md: null,
    spec_path: null,
    spec_pr_url: null,
    spec_pr_number: null,
    issue_number: null,
    issue_url: null,
  };
}

/** A fresh `running` iteration row. */
function newIteration(args: {
  featureId: string;
  iteration: number;
  userAnswers: unknown;
  parentIteration: number | null;
  now: string;
}): FeatureIteration {
  return {
    id: randomUUID(),
    feature_id: args.featureId,
    iteration: args.iteration,
    task_id: null,
    status: "running",
    user_answers: args.userAnswers ?? null,
    gap_result: null,
    parent_iteration: args.parentIteration,
    created_at: args.now,
    updated_at: args.now,
  };
}

/** In-memory {@link FeaturesPort}: behavioral spec of the Pg adapter; JSONB values stored as their post-round-trip parsed form. `clock` is injectable for deterministic updated_at ordering in tests. */
export class InMemoryFeatures implements FeaturesPort {
  readonly rows: Feature[] = [];
  readonly iterations: FeatureIteration[] = [];

  constructor(private readonly clock: () => Date = () => new Date()) {}

  private insertFeature(
    repo: string,
    input: CreateFeatureInput,
    parentFeatureId: string | null,
  ): Feature {
    const now = this.clock().toISOString();
    const feature: Feature = {
      ...featureContent(input, slugifyFeatureTitle(input.title)),
      ...featureDefaults(),
      repo,
      parent_feature_id: parentFeatureId,
      created_at: now,
      updated_at: now,
    };

    this.rows.push(feature);

    return feature;
  }

  async create(repo: string, input: CreateFeatureInput): Promise<Feature> {
    return this.insertFeature(repo, input, input.parentFeatureId ?? null);
  }

  // eslint-disable-next-line re-lint/no-duplicate-code -- the in-memory features adapter; createSplitChild and its neighbours match the pg adapter because the port declares them, while the bodies store Maps rather than rows
  async createSplitChild(
    repo: string,
    parentId: string,
    input: CreateFeatureInput,
  ): Promise<Feature> {
    return this.insertFeature(repo, input, parentId);
  }

  async get(repo: string, id: string): Promise<FeatureWithIterations | null> {
    const feature = this.find(repo, id);

    if (!feature) {
      return null;
    }
    const iterations = this.iterations
      .filter((i) => i.feature_id === id)
      .sort((a, b) => a.iteration - b.iteration);

    return { ...feature, iterations };
  }

  async list(repo: string, status?: FeatureStatus): Promise<Feature[]> {
    return this.rows
      .filter((f) => f.repo === repo && (!status || f.status === status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async appendIteration(
    repo: string,
    id: string,
    userAnswers: unknown,
    parentIteration: number | null = null,
  ): Promise<FeatureIteration> {
    const feature = this.find(repo, id);

    // Mirrors the Pg adapter's unguarded dereference of the UPDATE's returned row — a missing feature throws there too.
    enforceTrue(feature, Error, "appendIteration: feature not found");
    const iteration = newIteration({
      featureId: id,
      iteration: this.bumpIteration(feature),
      userAnswers,
      parentIteration,
      now: this.clock().toISOString(),
    });

    this.iterations.push(iteration);

    return iteration;
  }

  async attachIterationTask(
    repo: string,
    id: string,
    iteration: number,
    taskId: string,
  ): Promise<void> {
    const row = this.findIteration(repo, id, iteration);

    if (!row) {
      return;
    }
    row.task_id = taskId;
    row.updated_at = this.clock().toISOString();
  }

  async setIterationResult(
    repo: string,
    id: string,
    iteration: number,
    { gap, status }: IterationResult,
  ): Promise<void> {
    const row = this.findIteration(repo, id, iteration);

    if (!row) {
      return;
    }
    row.gap_result = gap;
    row.status = status;
    row.updated_at = this.clock().toISOString();
  }

  async transitionStatus(
    repo: string,
    id: string,
    status: FeatureStatus,
    patch?: FeaturePatch,
  ): Promise<Feature> {
    const feature = this.find(repo, id);

    if (!feature) {
      // Mirrors the Pg `rows[0] as Feature` on a no-match UPDATE.
      return undefined as unknown as Feature;
    }
    feature.status = status;

    for (const col of PATCH_COLUMNS) {
      const value = patch?.[col];

      if (value !== undefined) {
        (feature as unknown as Record<string, unknown>)[col] = value;
      }
    }
    feature.updated_at = this.clock().toISOString();

    return feature;
  }

  async delete(repo: string, id: string): Promise<boolean> {
    const feature = this.find(repo, id);

    if (!feature) {
      return false;
    }
    this.rows.splice(this.rows.indexOf(feature), 1);

    // feature_iterations cascade via ON DELETE CASCADE (migration 0017).
    for (let i = this.iterations.length - 1; i >= 0; i--) {
      if (this.iterations[i].feature_id === id) {
        this.iterations.splice(i, 1);
      }
    }

    return true;
  }

  /** Claims the next iteration number and puts the feature back into `planning`, as the Pg adapter's counter UPDATE does. */
  private bumpIteration(feature: Feature): number {
    feature.current_iteration += 1;
    feature.status = "planning";
    feature.updated_at = this.clock().toISOString();

    return feature.current_iteration;
  }

  private find(repo: string, id: string): Feature | undefined {
    return this.rows.find((f) => f.id === id && f.repo === repo);
  }

  /** Iteration writes are repo-scoped through the owning feature (the EXISTS join in Pg — cross-repo forgery defense), so a wrong repo finds nothing. */
  private findIteration(
    repo: string,
    featureId: string,
    iteration: number,
  ): FeatureIteration | undefined {
    if (!this.find(repo, featureId)) {
      return undefined;
    }

    return this.iterations.find(
      (i) => i.feature_id === featureId && i.iteration === iteration,
    );
  }
}
