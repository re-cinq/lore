import type { TemplateSection } from "./context-assembly-templates.js";
import type {
  SourceItem,
  SerializedSection,
} from "./context-assembly-format.js";
import { dedupeItems } from "./context-assembly-format.js";
import type {
  FetchStatus,
  FetchResult,
  TraceSection,
} from "./context-assembly-types.js";
import { dropSeen, fitItemsToBudget } from "./context-assembly-items.js";

/** Allocating the token budget across sections by priority, and packing each section's deduped items into its share. */

const STATUS_REASON: Record<FetchStatus, string> = {
  ok: "",
  empty: "no results",
  error: "source error",
  "no-match": "no rule matched the query",
  disabled: "source disabled",
};

interface SectionFit {
  allocatedBudget: number;
  finalTokens: number;
  truncated: boolean;
  included: boolean;
  omitReason?: string;
  keptItems: SourceItem[];
}

/** What is left to hand out and how this section's share of it is weighted. */
interface SectionBudget {
  remaining: number;
  minTokens: number;
  nonEmptyWeight: number;
}

function emptyStatusReason(status: FetchStatus): string {
  return STATUS_REASON[status] || "empty";
}

/** Caps any single competing document to half the budget so a mega-doc can't crowd out smaller ones; a lone document keeps it all. */
function perDocCapFor(
  deduped: SourceItem[],
  allocatedBudget: number,
): number | undefined {
  return deduped.length > 1 ? Math.floor(allocatedBudget * 0.5) : undefined;
}

/** Budget one section's deduped items: how much it gets, what survives, why it was omitted. Pure — the caller applies the deduction. */
/** How many tokens this section may spend. Weighted by PRIORITY — priority 1 gets the largest share — and normalized across the sections that actually returned something, so an empty source hands its budget to the others rather than wasting it. The 1.5x allows deliberate per-section overflow: sections rarely fill their share exactly, and the hard `remaining` cap still bounds the total. */
function allocate(
  section: { priority: number; max_tokens?: number },
  { remaining, minTokens, nonEmptyWeight }: SectionBudget,
): number {
  const weight = (6 - section.priority) / nonEmptyWeight;

  return Math.min(
    section.max_tokens ?? Infinity,
    Math.floor(minTokens * weight * 1.5),
    remaining,
  );
}

/** A section that contributed nothing. Zeroed rather than absent so the trace can still show it was considered — "omitted, budget exhausted" is information the caller acts on; a missing entry is not. */
const EXCLUDED_SECTION = {
  allocatedBudget: 0,
  finalTokens: 0,
  truncated: false,
  included: false,
  keptItems: [] as SourceItem[],
};

/** A section that did contribute. `included` is keyed on items kept, not on budget spent: a section allocated room that nothing fitted into is omitted, not empty. */
function includedSection(
  allocatedBudget: number,
  fit: ReturnType<typeof fitItemsToBudget>,
): SectionFit {
  return {
    allocatedBudget,
    finalTokens: fit.kept.reduce((sum, i) => sum + i.tokens, 0),
    truncated: fit.truncated,
    included: fit.kept.length > 0,
    keptItems: fit.kept,
  };
}

/** No room left — either the running total ran out, or this section's share was too small to hold a useful excerpt. */
function budgetExhausted(allocatedBudget = 0): SectionFit {
  return {
    ...EXCLUDED_SECTION,
    allocatedBudget,
    omitReason: "budget exhausted",
  };
}

/** The items that fit, packed at the section's allocated share with the per-doc cap applied. */
function fittedSection(
  deduped: SourceItem[],
  allocatedBudget: number,
): SectionFit {
  return includedSection(
    allocatedBudget,
    fitItemsToBudget(
      deduped,
      allocatedBudget,
      perDocCapFor(deduped, allocatedBudget),
    ),
  );
}

function fitSection(
  deduped: SourceItem[],
  status: FetchStatus,
  section: { priority: number; max_tokens?: number },
  budget: SectionBudget,
): SectionFit {
  if (deduped.length === 0) {
    return { ...EXCLUDED_SECTION, omitReason: emptyStatusReason(status) };
  }

  if (budget.remaining <= 0) {
    return budgetExhausted();
  }
  const allocatedBudget = allocate(section, budget);

  // Under ~100 tokens there is no room for a useful excerpt — half a paragraph is worse than saying the section was omitted.
  if (allocatedBudget <= 100) {
    return budgetExhausted(allocatedBudget);
  }

  return fittedSection(deduped, allocatedBudget);
}

export interface FetchedSection {
  section: TemplateSection;
  res: FetchResult;
}

function computeNonEmptyWeight(fetched: FetchedSection[]): number {
  return (
    fetched
      .filter((f) => f.res.sources.length > 0)
      .reduce((sum, f) => sum + (6 - f.section.priority), 0) || 1
  );
}

function buildSerializedSection(
  section: TemplateSection,
  fit: SectionFit,
): SerializedSection {
  return {
    header: section.header,
    source: section.source,
    priority: section.priority,
    documents: fit.keptItems,
    truncated: fit.truncated,
  };
}

interface SectionFitOutcome {
  section: TemplateSection;
  res: FetchResult;
  fit: SectionFit;
  deduped: SourceItem[];
  rawTokens: number;
}

function buildTraceSection(outcome: SectionFitOutcome): TraceSection {
  const { section, res, fit, deduped, rawTokens } = outcome;

  return {
    header: section.header,
    source: section.source,
    priority: section.priority,
    status: res.status,
    allocatedBudget: Number.isFinite(fit.allocatedBudget)
      ? fit.allocatedBudget
      : (section.max_tokens ?? 0),
    rawTokens,
    finalTokens: fit.finalTokens,
    truncated: fit.truncated,
    included: fit.included,
    omitReason: fit.omitReason,
    items: fit.included ? fit.keptItems : deduped,
  };
}

export interface AllocatedSections {
  serialized: SerializedSection[];
  traceSections: TraceSection[];
}

interface SectionWeights {
  minTokens: number;
  nonEmptyWeight: number;
}

/** One section's dedupe-then-fit pass, against what the sections before it already claimed. */
function fitOneSection(
  { section, res }: FetchedSection,
  seenAcrossSections: Set<string>,
  remaining: number,
  { minTokens, nonEmptyWeight }: SectionWeights,
): SectionFitOutcome {
  const deduped = dropSeen(dedupeItems(res.sources), seenAcrossSections);
  const rawTokens = deduped.reduce((sum, i) => sum + i.tokens, 0);
  const fit = fitSection(deduped, res.status, section, {
    remaining,
    minTokens,
    nonEmptyWeight,
  });

  return { section, res, fit, deduped, rawTokens };
}

function orderedByPriority(fetched: FetchedSection[]): FetchedSection[] {
  return [...fetched].sort((a, b) => a.section.priority - b.section.priority);
}

/** Walk the priority-ordered sections, deducting each included section's tokens from what the rest may spend. */
function packSections(
  ordered: FetchedSection[],
  weights: SectionWeights,
): AllocatedSections {
  let remaining = weights.minTokens;
  const serialized: SerializedSection[] = [];
  const traceSections: TraceSection[] = [];
  const seen = new Set<string>();

  for (const entry of ordered) {
    const outcome = fitOneSection(entry, seen, remaining, weights);

    if (outcome.fit.included) {
      remaining -= outcome.fit.finalTokens;
      serialized.push(buildSerializedSection(entry.section, outcome.fit));
    }
    traceSections.push(buildTraceSection(outcome));
  }

  return { serialized, traceSections };
}

/** Allocate the token budget by priority (lower number = larger share), highest first, deducting as we go. A document is emitted in its highest-priority section only — no repeats across sections. */
export function allocateSections(
  fetched: FetchedSection[],
  minTokens: number,
): AllocatedSections {
  return packSections(orderedByPriority(fetched), {
    minTokens,
    nonEmptyWeight: computeNonEmptyWeight(fetched),
  });
}
