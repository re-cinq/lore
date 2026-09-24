// The spec analysis's answer, carried from the line's args into the writing step's prompt: the writer edits the files and statements the analysis chose instead of guessing them from plan.md (#2175 — the analysis was merged into args.spec_plan and read by nothing).

/** The slot a recipe declares to receive the analysis; a recipe without it is untouched. */
export const SPEC_PLAN_SLOT = "{spec_plan}";

const SPEC_PLAN_ARG = "spec_plan";

interface SpecPlanUpdate {
  path: string;
  reason?: string;
  statements?: string[];
  guidance?: string;
}

interface SpecPlanCreate {
  path: string;
  title?: string;
  reason?: string;
  outline?: string[];
  guidance?: string;
}

interface SpecPlanAdr {
  path: string;
  decision?: string;
  why_now?: string;
}

interface SpecPlanConsidered {
  path: string;
  why_not?: string;
}

/** spec-plan.json as the analysis recipe defines it; every field optional so a thin plan still renders. */
export interface SpecPlan {
  standard?: string;
  updates?: SpecPlanUpdate[];
  creates?: SpecPlanCreate[];
  adrs?: SpecPlanAdr[];
  considered?: SpecPlanConsidered[];
  summary?: string;
}

/** The spec plan the run's args carry, as the write node reads it: the artifact lands as JSON text, an older run may hold it as an object; null when no analysis delivered one or what it delivered does not parse. */
export function specPlanOf(
  args: Readonly<Record<string, unknown>>,
): SpecPlan | null {
  const raw = args[SPEC_PLAN_ARG];

  return typeof raw === "string" ? parseSpecPlan(raw) : asSpecPlan(raw);
}

function parseSpecPlan(text: string): SpecPlan | null {
  try {
    return asSpecPlan(JSON.parse(text));
  } catch {
    return null;
  }
}

// A spec plan is an object with named fields; an array or a scalar is not one, however it was stored.
function asSpecPlan(value: unknown): SpecPlan | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SpecPlan)
    : null;
}

/** What the writer reads in the slot when the run carries no analysis: said outright, so the pod never sees a literal `{spec_plan}` and knows it works from the plan and the branch alone. A refusal here once failed a whole line: the hand-run had already cancelled the PR wait when the launch threw (plan b4b2026f, 2026-09-24). */
export const NO_SPEC_PLAN =
  "No spec analysis was delivered for this run. Work from plan.md and the specs already on this branch: find the statements the plan overtakes yourself, and say in your final message that you did so without an analysis.";

/** Fill the recipe's `{spec_plan}` slot with the analysis rendered as Markdown; a recipe without the slot is untouched, and one launched on a run that carries no spec plan reads {@link NO_SPEC_PLAN} there, logged so the missing hand-off is visible. */
export function withSpecPlan(prompt: string, plan: SpecPlan | null): string {
  if (!prompt.includes(SPEC_PLAN_SLOT)) {
    return prompt;
  }

  if (plan === null) {
    console.warn(
      "[spec-plan] the recipe expects the spec analysis in {spec_plan}, but the run's args carry no valid spec_plan — the writer works without it",
    );
  }

  return prompt.replace(SPEC_PLAN_SLOT, () =>
    plan === null ? NO_SPEC_PLAN : renderSpecPlan(plan),
  );
}

/** The analysis as the writer reads it: each file to change with its statements and guidance, each file to create, each ADR, and the files deliberately left alone. */
export function renderSpecPlan(plan: SpecPlan): string {
  return [
    section("Standard", plan.standard),
    ...(plan.updates ?? []).map(updateBlock),
    ...(plan.creates ?? []).map(createBlock),
    ...(plan.adrs ?? []).map(adrBlock),
    consideredBlock(plan.considered ?? []),
    section("Summary", plan.summary),
  ]
    .filter((block) => block !== "")
    .join("\n\n");
}

function section(title: string, body: string | undefined): string {
  return body ? `### ${title}\n\n${body}` : "";
}

function updateBlock(update: SpecPlanUpdate): string {
  return lines([
    `### Update \`${update.path}\``,
    "",
    labelled("Why", update.reason),
    bullets("Statements that change", update.statements),
    labelled("Guidance", update.guidance),
  ]);
}

function createBlock(create: SpecPlanCreate): string {
  const title = create.title ? ` — ${create.title}` : "";

  return lines([
    `### Create \`${create.path}\`${title}`,
    "",
    labelled("Why", create.reason),
    bullets("Outline", create.outline),
    labelled("Guidance", create.guidance),
  ]);
}

function adrBlock(adr: SpecPlanAdr): string {
  return lines([
    `### ADR \`${adr.path}\``,
    "",
    labelled("Decision", adr.decision),
    labelled("Why now", adr.why_now),
  ]);
}

function consideredBlock(considered: SpecPlanConsidered[]): string {
  if (considered.length === 0) {
    return "";
  }

  return lines([
    "### Left alone on purpose — do not touch these",
    "",
    ...considered.map(
      (c) => `- \`${c.path}\`${c.why_not ? `: ${c.why_not}` : ""}`,
    ),
  ]);
}

function labelled(label: string, text: string | undefined): string {
  return text ? `${label}: ${text}` : "";
}

function bullets(label: string, texts: string[] | undefined): string {
  if (!texts || texts.length === 0) {
    return "";
  }

  return [`${label}:`, ...texts.map((text) => `- ${text}`)].join("\n");
}

function lines(parts: string[]): string {
  return parts.filter((part, index) => part !== "" || index === 1).join("\n");
}
