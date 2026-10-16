import type {
  TracePort,
  TraceDocument,
  SpecSummary,
  AdrSummary,
  SpecGraph,
  SpecRing,
  CoveringTest,
  FailureHit,
  CodeCaller,
  GraphContextBlock,
} from "./trace-port.js";

export function noGraphMessage(service: string): string {
  return `${service} has no Dgraph client (LORE_DGRAPH_HTTP unset)`;
}

/** TracePort for a deployment with no graph: the reads that degrade to "nothing known" answer empty, the document reads refuse naming the service. */
export class NoGraphTrace implements TracePort {
  constructor(private readonly service: string) {}

  async listSpecs(): Promise<string[]> {
    throw this.refusal();
  }

  async specSummaries(): Promise<SpecSummary[]> {
    throw this.refusal();
  }

  async listAdrs(): Promise<string[]> {
    throw this.refusal();
  }

  async adrSummaries(): Promise<AdrSummary[]> {
    throw this.refusal();
  }

  async document(): Promise<TraceDocument> {
    throw this.refusal();
  }

  async source(): Promise<string | null> {
    throw this.refusal();
  }

  async graph(): Promise<SpecGraph> {
    throw this.refusal();
  }

  async ring(): Promise<SpecRing> {
    throw this.refusal();
  }

  async testsCovering(): Promise<CoveringTest[]> {
    throw this.refusal();
  }

  async failuresTouching(): Promise<FailureHit[]> {
    return [];
  }

  async callers(): Promise<CodeCaller[]> {
    return [];
  }

  async graphContext(): Promise<GraphContextBlock> {
    return { statements: [], adrRefs: [], testSelectors: [], truncated: false };
  }

  private refusal(): Error {
    return new Error(noGraphMessage(this.service));
  }
}
