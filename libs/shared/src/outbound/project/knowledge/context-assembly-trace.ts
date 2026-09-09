/** The debug trace: what each source was asked for, what it contributed, and how long it took — the record a caller reads when an assembled block is not what they expected. */

import type { Template } from "./context-assembly-templates.js";
import type { TraceSection } from "./context-assembly-types.js";
import type { FreshnessInfo } from "./context-assembly-freshness.js";

export interface AssemblyTrace {
  query: string;
  template: string;
  effectiveBudget: number;
  crossRepo: boolean;
  templateSections: {
    header: string;
    source: string;
    priority: number;
    max_tokens?: number;
  }[];
  sections: TraceSection[];
  budget: { total: number; used: number; leftover: number };
  freshness: { state: string; message: string };
  /** True when the embedder had failed enough in a row that every hybrid source ranked keyword-only. */
  embedderDegraded: boolean;
  timingsMs: { total: number; perSource: Record<string, number> };
}

export interface DebugTraceInput {
  query: string;
  templateName: string;
  minTokens: number;
  crossRepo: boolean | undefined;
  template: Template;
  traceSections: TraceSection[];
  sections: { header: string; tokens: number; truncated: boolean }[];
  freshness: FreshnessInfo;
  embedderDegraded: boolean;
  startedAt: number;
  timings: Record<string, number>;
}

export function buildAssemblyTrace(input: DebugTraceInput): AssemblyTrace {
  return {
    query: input.query,
    template: input.templateName,
    effectiveBudget: input.minTokens,
    crossRepo: !!input.crossRepo,
    templateSections: templateSectionsTrace(input.template),
    sections: input.traceSections,
    budget: budgetTrace(input.minTokens, input.sections),
    freshness: freshnessTrace(input.freshness),
    embedderDegraded: input.embedderDegraded,
    timingsMs: {
      total: Date.now() - input.startedAt,
      perSource: input.timings,
    },
  };
}

/** The template's own section list, before any of it was fetched — the trace shows what was ASKED for beside what came back. */
function templateSectionsTrace(template: Template) {
  return template.sections.map((s) => ({
    header: s.header,
    source: s.source,
    priority: s.priority,
    max_tokens: s.max_tokens,
  }));
}

function budgetTrace(
  minTokens: number,
  sections: { tokens: number }[],
): AssemblyTrace["budget"] {
  const used = sections.reduce((sum, s) => sum + s.tokens, 0);

  return { total: minTokens, used, leftover: Math.max(0, minTokens - used) };
}

function freshnessTrace(freshness: FreshnessInfo): AssemblyTrace["freshness"] {
  return { state: freshness.state, message: freshness.warning.trim() };
}
