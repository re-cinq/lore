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
function fitSection(
  deduped: SourceItem[],
  status: FetchStatus,
  section: { priority: number; max_tokens?: number },
  { remaining, minTokens, nonEmptyWeight }: SectionBudget,
): SectionFit {
  const excluded = {
    allocatedBudget: 0,
    finalTokens: 0,
    truncated: false,
    included: false,
    keptItems: [] as SourceItem[],
  };

  if (deduped.length === 0) {
    return { ...excluded, omitReason: emptyStatusReason(status) };
  }

  if (remaining <= 0) {
    return { ...excluded, omitReason: "budget exhausted" };
  }
  const weight = (6 - section.priority) / nonEmptyWeight;
  const allocatedBudget = Math.min(
    section.max_tokens ?? Infinity,
    Math.floor(minTokens * weight * 1.5), // allow some per-section overflow
    remaining,
  );

  if (allocatedBudget <= 100) {
    return { ...excluded, allocatedBudget, omitReason: "budget exhausted" };
  }
  const fit = fitItemsToBudget(
    deduped,
    allocatedBudget,
    perDocCapFor(deduped, allocatedBudget),
  );

  return {
    allocatedBudget,
    finalTokens: fit.kept.reduce((sum, i) => sum + i.tokens, 0),
    truncated: fit.truncated,
    included: fit.kept.length > 0,
    keptItems: fit.kept,
  };
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

/** Allocate the token budget by priority (lower number = larger share), highest first, deducting as we go. A document is emitted in its highest-priority section only — no repeats across sections. */
export function allocateSections(
  fetched: FetchedSection[],
  minTokens: number,
): AllocatedSections {
  const nonEmptyWeight = computeNonEmptyWeight(fetched);
  const ordered = [...fetched].sort(
    (a, b) => a.section.priority - b.section.priority,
  );

  let remaining = minTokens;
  const serialized: SerializedSection[] = [];
  const traceSections: TraceSection[] = [];
  const seenAcrossSections = new Set<string>();

  for (const { section, res } of ordered) {
    const deduped = dropSeen(dedupeItems(res.sources), seenAcrossSections);
    const rawTokens = deduped.reduce((sum, i) => sum + i.tokens, 0);
    const fit = fitSection(deduped, res.status, section, {
      remaining,
      minTokens,
      nonEmptyWeight,
    });

    if (fit.included) {
      remaining -= fit.finalTokens;
      serialized.push(buildSerializedSection(section, fit));
    }

    traceSections.push(
      buildTraceSection({ section, res, fit, deduped, rawTokens }),
    );
  }

  return { serialized, traceSections };
}
