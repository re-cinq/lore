// Mirror of the feature-planning shapes the mcp-server returns. web-ui is not a
// workspace member, so these mirror the canonical types in
// @re-cinq/lore-shared (project/features + feature-planning/gap-result).
// Optional-everything on the GapResult so the renderer tolerates partial/old
// payloads. See specs/7-feature-planning/ and ADR-027.

export type FeatureStatus =
  | 'draft'
  | 'planning'
  | 'awaiting-input'
  | 'spec-ready'
  | 'pr-open'
  | 'implemented'
  | 'split';

export type IterationStatus = 'running' | 'ready' | 'failed';

export interface FeatureRow {
  id: string;
  repo: string;
  title: string;
  slug: string;
  path: string;
  original_prompt: string;
  status: FeatureStatus;
  current_iteration: number;
  draft_spec_md: string | null;
  parent_feature_id: string | null;
  spec_path: string | null;
  spec_pr_url: string | null;
  spec_pr_number: number | null;
  issue_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureIterationRow {
  id: string;
  feature_id: string;
  iteration: number;
  task_id: string | null;
  status: IterationStatus;
  user_answers: SectionAnswers | null;
  gap_result: GapResult | null;
  created_at: string;
}

export interface FeatureWithIterations extends FeatureRow {
  iterations: FeatureIterationRow[];
}

export type SectionDirection = 'keep' | 'refine' | 'redirect';

export interface SectionAnswers {
  sections?: Record<string, { comment?: string; direction?: SectionDirection }>;
  questions?: Record<string, string>;
  free_form?: string;
}

// GapResult mirror — every section optional so GapSections can render-or-skip.
export interface GapMockup {
  title?: string;
  format?: 'svg';
  markup: string;
  /** Which section this diagram illustrates, so it embeds inline next to that text. */
  section?: string;
}
export interface GapQuestion {
  id: string;
  question: string;
  why?: string;
  kind?: 'text' | 'choice';
  options?: string[];
}
export interface GapResult {
  architecture?: { summary: string; components: { name: string; responsibility: string; touchpoints: string[] }[] };
  user_flows?: { name: string; steps: string[] }[];
  mockups?: GapMockup[];
  questions?: GapQuestion[];
  split_suggestion?: { rationale: string; proposed_features: { title: string; scope: string }[] };
  draft_spec_markdown?: string;
}
