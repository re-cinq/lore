import type { GapResult } from "../../feature-planning/gap-result.js";
import type {
  FeaturesPort,
  Feature,
  FeatureIteration,
  FeatureWithIterations,
  FeatureStatus,
  IterationStatus,
  FeaturePatch,
  CreateFeatureInput,
} from "./features-port.js";

/**
 * project.features — the repo-bound feature-planning surface. Stamps the bound
 * repo onto every call so callers only supply feature-level arguments.
 */
export class Features {
  constructor(
    private readonly repo: string,
    private readonly port: FeaturesPort,
  ) {}

  create(input: CreateFeatureInput): Promise<Feature> {
    return this.port.create(this.repo, input);
  }

  get(id: string): Promise<FeatureWithIterations | null> {
    return this.port.get(this.repo, id);
  }

  list(status?: FeatureStatus): Promise<Feature[]> {
    return this.port.list(this.repo, status);
  }

  appendIteration(
    id: string,
    userAnswers: unknown,
    parentIteration?: number | null,
  ): Promise<FeatureIteration> {
    return this.port.appendIteration(
      this.repo,
      id,
      userAnswers,
      parentIteration,
    );
  }

  attachIterationTask(
    id: string,
    iteration: number,
    taskId: string,
  ): Promise<void> {
    return this.port.attachIterationTask(this.repo, id, iteration, taskId);
  }

  setIterationResult(
    id: string,
    iteration: number,
    gap: GapResult | null,
    status: IterationStatus,
  ): Promise<void> {
    return this.port.setIterationResult(this.repo, id, iteration, gap, status);
  }

  transitionStatus(
    id: string,
    status: FeatureStatus,
    patch?: FeaturePatch,
  ): Promise<Feature> {
    return this.port.transitionStatus(this.repo, id, status, patch);
  }

  createSplitChild(
    parentId: string,
    input: CreateFeatureInput,
  ): Promise<Feature> {
    return this.port.createSplitChild(this.repo, parentId, input);
  }

  delete(id: string): Promise<boolean> {
    return this.port.delete(this.repo, id);
  }
}
