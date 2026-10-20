import type { SourceItem } from "./context-assembly-format.js";
import type { TemplateSection } from "./context-assembly-templates.js";

/** Shared fetch-status + trace shapes used by every context-assembly source and the budget allocator. */

export type FetchStatus = "ok" | "empty" | "error" | "no-match" | "disabled";

export interface FetchResult {
  sources: SourceItem[];
  status: FetchStatus;
  vectorLegRows?: number;
}

export interface TraceSection {
  header: string;
  source: string;
  priority: number;
  status: FetchStatus;
  allocatedBudget: number;
  rawTokens: number;
  finalTokens: number;
  truncated: boolean;
  included: boolean;
  omitReason?: string;
  vectorLegRows?: number;
  items: SourceItem[];
}

/** How one store answers one template section; a throw counts as that section's error, not the assembly's. */
export type SectionReader = (section: TemplateSection) => Promise<FetchResult>;
