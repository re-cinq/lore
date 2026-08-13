// Mirror of the feature-planning shapes the mcp-server returns. web-ui is not a
// workspace member, so these mirror the canonical types in
// @re-cinq/lore-shared (project/features + feature-planning/gap-result).
// Optional-everything on the GapResult so the renderer tolerates partial/old
// payloads. See specs/7-feature-planning/ and ADR-027.

export type FeatureStatus =
  | "draft"
  | "planning"
  | "awaiting-input"
  | "spec-ready"
  | "pr-open"
  | "implemented"
  | "split";

export type IterationStatus = "running" | "ready" | "failed";

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
  /** The round this one forked from — set only when the author rewound. */
  parent_iteration?: number | null;
  created_at: string;
}

export interface FeatureWithIterations extends FeatureRow {
  iterations: FeatureIterationRow[];
}

export type SectionDirection = "keep" | "refine" | "redirect";

export interface SectionAnswers {
  sections?: Record<string, { comment?: string; direction?: SectionDirection }>;
  questions?: Record<string, string>;
  free_form?: string;
}

// GapResult mirror — adaptive `sections` (first is the Overview); legacy fields kept
// optional so old stored results still render via sectionsOf().
export interface GapMockup {
  title?: string;
  format?: "svg" | "mermaid" | "html";
  markup: string;
  section?: string;
  /** Pixel height an `html` mockup needs — its frame is sandboxed with no
   *  same-origin access, so it cannot measure itself. */
  height?: number;
}
export interface GapQuestion {
  id: string;
  question: string;
  why?: string;
  kind?: "text" | "choice";
  options?: string[];
}
export interface GapSection {
  title: string;
  content?: string;
  mockups?: GapMockup[];
  questions?: GapQuestion[];
}
export interface GapResult {
  sections?: GapSection[];
  /** CSS lifted from the PLANNED repo, shared by every mockup in this result. */
  mockup_stylesheet?: string;
  // legacy shape (pre-dynamic-sections) — normalized by sectionsOf for old results:
  architecture?: {
    summary: string;
    components: {
      name: string;
      responsibility: string;
      touchpoints: string[];
    }[];
  };
  user_flows?: { name: string; steps: string[] }[];
  mockups?: GapMockup[];
  questions?: GapQuestion[];
  split_suggestion?: {
    rationale: string;
    proposed_features: { title: string; scope: string }[];
  };
  draft_spec_markdown?: string;
}

/** A uniform sections list — new `sections` if present, else derived from the legacy
 *  shape so old stored results still render. Mirrors shared's `sectionsOf`. */
export function sectionsOf(gap: GapResult | null | undefined): GapSection[] {
  if (!gap) {
    return [];
  }

  if (gap.sections) {
    return gap.sections;
  }
  const sections: GapSection[] = [];
  const mockupsFor = (key: string) =>
    (gap.mockups ?? []).filter((m) => (m.section ?? "architecture") === key);

  if (gap.architecture) {
    const a = gap.architecture;
    const lines = [
      a.summary,
      ...(a.components ?? []).map(
        (c) => `- **${c.name}**: ${c.responsibility}`,
      ),
    ];
    const m = mockupsFor("architecture");

    sections.push({
      title: "Architecture",
      content: lines.join("\n"),
      ...(m.length ? { mockups: m } : {}),
    });
  }

  if (gap.user_flows?.length) {
    const content = gap.user_flows
      .map((f) =>
        [`**${f.name}**`, ...f.steps.map((s, i) => `${i + 1}. ${s}`)].join(
          "\n",
        ),
      )
      .join("\n\n");
    const m = mockupsFor("user_flows");

    sections.push({
      title: "User flows",
      content,
      ...(m.length ? { mockups: m } : {}),
    });
  }

  if (gap.questions?.length) {
    sections.push({ title: "Open questions", questions: gap.questions });
  }

  return sections;
}
