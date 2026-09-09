import type { SourceItem } from "./context-assembly-format.js";

/** Shared fetch-status + trace shapes used by every context-assembly source and the budget allocator. */

export type FetchStatus = "ok" | "empty" | "error" | "no-match" | "disabled";

export interface FetchResult {
  sources: SourceItem[];
  status: FetchStatus;
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
  items: SourceItem[];
}
