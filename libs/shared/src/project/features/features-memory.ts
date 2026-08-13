import { randomUUID } from "node:crypto";
import { enforceTrue } from "../../lib/enforce.js";
import type { GapResult } from "../../feature-planning/gap-result.js";
import {
  PATCH_COLUMNS,
  slugifyFeatureTitle,
  type FeaturesPort,
  type Feature,
  type FeatureIteration,
  type FeatureWithIterations,
  type FeatureStatus,
  type IterationStatus,
  type CreateFeatureInput,
  type FeaturePatch,
} from "./features-port.js";

/**
 * In-memory {@link FeaturesPort}: the behavioral spec of the Pg adapter over
 * `lore.features` + `lore.feature_iterations`. JSONB values are stored as their
 * post-round-trip parsed form (node-pg returns jsonb already parsed, so through
 * the Pg adapter callers only ever see the parsed value). `clock` is injectable
 * so updated_at ordering is deterministic in tests.
 */
export class InMemoryFeatures implements FeaturesPort {
  readonly rows: Feature[] = [];
  readonly iterations: FeatureIteration[] = [];

  constructor(public clock: () => Date = () => new Date()) {}

  private insertFeature(
    repo: string,
    input: CreateFeatureInput,
    parentFeatureId: string | null,
  ): Feature {
    const slug = slugifyFeatureTitle(input.title);
    const now = this.clock().toISOString();
    const feature: Feature = {
      id: randomUUID(),
      repo,
      title: input.title,
      slug,
      path: `specs/${slug}`,
      original_prompt: input.prompt,
      status: "draft",
      current_iteration: 0,
      draft_spec_md: null,
      parent_feature_id: parentFeatureId,
      spec_path: null,
      spec_pr_url: null,
      spec_pr_number: null,
      issue_number: null,
      issue_url: null,
      created_by: input.createdBy ?? "ui",
      created_at: now,
      updated_at: now,
    };

    this.rows.push(feature);

    return feature;
  }

  async create(repo: string, input: CreateFeatureInput): Promise<Feature> {
    return this.insertFeature(repo, input, input.parentFeatureId ?? null);
  }

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

    // The Pg adapter dereferences the UPDATE's returned row unguarded — a
    // missing feature throws there too.
    enforceTrue(feature, Error, "appendIteration: feature not found");
    feature.current_iteration += 1;
    feature.status = "planning";
    feature.updated_at = this.clock().toISOString();
    const now = this.clock().toISOString();
    const iteration: FeatureIteration = {
      id: randomUUID(),
      feature_id: id,
      iteration: feature.current_iteration,
      task_id: null,
      status: "running",
      user_answers: userAnswers ?? null,
      gap_result: null,
      parent_iteration: parentIteration,
      created_at: now,
      updated_at: now,
    };

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
    gap: GapResult | null,
    status: IterationStatus,
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

  private find(repo: string, id: string): Feature | undefined {
    return this.rows.find((f) => f.id === id && f.repo === repo);
  }

  /**
   * Iteration writes are repo-scoped through the owning feature (the EXISTS
   * join in Pg — the cross-repo forgery defense), so a wrong repo finds nothing.
   */
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
