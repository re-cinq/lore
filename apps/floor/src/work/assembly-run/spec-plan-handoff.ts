// The spec analysis's answer, carried from the line's args into the writing step's prompt: the writer edits the files and statements the analysis chose instead of guessing them from plan.md (#2175 — the analysis was merged into args.spec_plan and read by nothing).

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

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

  if (typeof raw === "string") {
    return parseSpecPlan(raw);
  }

  return raw !== null && typeof raw === "object" ? (raw as SpecPlan) : null;
}

function parseSpecPlan(text: string): SpecPlan | null {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed !== null && typeof parsed === "object"
      ? (parsed as SpecPlan)
      : null;
  } catch {
    return null;
  }
}

/** Fill the recipe's `{spec_plan}` slot with the analysis rendered as Markdown. A recipe without the slot is untouched; one with it, launched on a run that carries no spec plan, is a wiring failure — the writer must never be left to guess. */
export function withSpecPlan(prompt: string, plan: SpecPlan | null): string {
  if (!prompt.includes(SPEC_PLAN_SLOT)) {
    return prompt;
  }
  enforceTrue(
    plan !== null,
    Error,
    "the recipe expects the spec analysis in {spec_plan}, but the run's args carry no spec_plan — the analysis node never delivered spec-plan.json",
  );

  return prompt.replace(SPEC_PLAN_SLOT, () => renderSpecPlan(plan));
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
