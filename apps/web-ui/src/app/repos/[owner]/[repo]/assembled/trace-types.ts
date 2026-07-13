/** Shape of the assembly trace returned by `/api/context?debug=1` (mirrors the
 *  `AssemblyTrace` the MCP server's `assembleContext` emits). */

export type FetchStatus = "ok" | "empty" | "error" | "no-match" | "disabled";

export interface SourceItem {
  text: string;
  tokens: number;
  source_path?: string;
  content_type?: string;
  repo?: string;
  score?: number;
  ingested_at?: string;
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
  timingsMs: { total: number; perSource: Record<string, number> };
}

export interface AssembledSection {
  header: string;
  tokens: number;
  truncated: boolean;
}

export interface AssembledResult {
  text: string | null;
  sections?: AssembledSection[];
  trace?: AssemblyTrace;
}
