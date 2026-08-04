import type { PgPool } from "../../memory-store.js";
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
  type FeaturePatch,
  type CreateFeatureInput,
} from "./features-port.js";

/**
 * Postgres-backed {@link FeaturesPort} over `lore.features` +
 * `lore.feature_iterations`. JSONB columns (`user_answers`, `gap_result`) are
 * returned already-parsed by node-pg, so reads map straight to the value types.
 */
export class PgFeatures implements FeaturesPort {
  constructor(private readonly pool: PgPool) {}

  private async insertFeature(
    repo: string,
    input: CreateFeatureInput,
    parentFeatureId: string | null,
  ): Promise<Feature> {
    const slug = slugifyFeatureTitle(input.title);
    const { rows } = await this.pool.query<Feature>(
      `INSERT INTO lore.features
         (repo, title, slug, path, original_prompt, status, parent_feature_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7)
       RETURNING *`,
      [
        repo,
        input.title,
        slug,
        `specs/${slug}`,
        input.prompt,
        parentFeatureId,
        input.createdBy ?? "ui",
      ],
    );

    return rows[0] as Feature;
  }

  create(repo: string, input: CreateFeatureInput): Promise<Feature> {
    return this.insertFeature(repo, input, input.parentFeatureId ?? null);
  }

  createSplitChild(
    repo: string,
    parentId: string,
    input: CreateFeatureInput,
  ): Promise<Feature> {
    return this.insertFeature(repo, input, parentId);
  }

  async get(repo: string, id: string): Promise<FeatureWithIterations | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM lore.features WHERE id = $1 AND repo = $2`,
      [id, repo],
    );
    const feature = rows[0] as unknown as Feature | undefined;

    if (!feature) {
      return null;
    }
    const { rows: iterations } = await this.pool.query(
      `SELECT * FROM lore.feature_iterations WHERE feature_id = $1 ORDER BY iteration ASC`,
      [id],
    );

    return {
      ...feature,
      iterations: iterations as unknown as FeatureIteration[],
    };
  }

  async list(repo: string, status?: FeatureStatus): Promise<Feature[]> {
    if (status) {
      const { rows } = await this.pool.query<Feature>(
        `SELECT * FROM lore.features WHERE repo = $1 AND status = $2 ORDER BY updated_at DESC`,
        [repo, status],
      );

      return rows as Feature[];
    }
    const { rows } = await this.pool.query<Feature>(
      `SELECT * FROM lore.features WHERE repo = $1 ORDER BY updated_at DESC`,
      [repo],
    );

    return rows as Feature[];
  }

  async appendIteration(
    repo: string,
    id: string,
    userAnswers: unknown,
  ): Promise<FeatureIteration> {
    const { rows } = await this.pool.query(
      `UPDATE lore.features
          SET current_iteration = current_iteration + 1,
              status = 'planning',
              updated_at = now()
        WHERE id = $1 AND repo = $2
        RETURNING current_iteration`,
      [id, repo],
    );
    const iteration = (rows[0] as { current_iteration: number })
      .current_iteration;
    const { rows: inserted } = await this.pool.query<FeatureIteration>(
      `INSERT INTO lore.feature_iterations
         (feature_id, iteration, status, user_answers)
       VALUES ($1, $2, 'running', $3)
       RETURNING *`,
      [id, iteration, userAnswers == null ? null : JSON.stringify(userAnswers)],
    );

    return inserted[0] as FeatureIteration;
  }

  async attachIterationTask(
    repo: string,
    id: string,
    iteration: number,
    taskId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE lore.feature_iterations fi
          SET task_id = $1, updated_at = now()
        WHERE fi.feature_id = $2 AND fi.iteration = $3
          AND EXISTS (SELECT 1 FROM lore.features f WHERE f.id = fi.feature_id AND f.repo = $4)`,
      [taskId, id, iteration, repo],
    );
  }

  async setIterationResult(
    repo: string,
    id: string,
    iteration: number,
    gap: GapResult | null,
    status: IterationStatus,
  ): Promise<void> {
    // Scope the write to the owning repo (feature_iterations has no repo column;
    // join through lore.features) so a write-token holder cannot overwrite
    // another repo's iteration by forging a global feature UUID.
    await this.pool.query(
      `UPDATE lore.feature_iterations fi
          SET gap_result = $1, status = $2, updated_at = now()
        WHERE fi.feature_id = $3 AND fi.iteration = $4
          AND EXISTS (SELECT 1 FROM lore.features f WHERE f.id = fi.feature_id AND f.repo = $5)`,
      [gap == null ? null : JSON.stringify(gap), status, id, iteration, repo],
    );
  }

  async transitionStatus(
    repo: string,
    id: string,
    status: FeatureStatus,
    patch?: FeaturePatch,
  ): Promise<Feature> {
    const sets = ["status = $1"];
    const params: unknown[] = [status];

    for (const col of PATCH_COLUMNS) {
      const value = patch?.[col];

      if (value !== undefined) {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      }
    }
    sets.push("updated_at = now()");
    params.push(id, repo);
    const { rows } = await this.pool.query<Feature>(
      `UPDATE lore.features SET ${sets.join(", ")}
        WHERE id = $${params.length - 1} AND repo = $${params.length}
        RETURNING *`,
      params,
    );

    return rows[0] as Feature;
  }

  async delete(repo: string, id: string): Promise<boolean> {
    // feature_iterations cascade via ON DELETE CASCADE (migration 0017).
    const { rows } = await this.pool.query(
      `DELETE FROM lore.features WHERE id = $1 AND repo = $2 RETURNING id`,
      [id, repo],
    );

    return rows.length > 0;
  }
}
