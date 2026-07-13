import type {
  UsagePort,
  LlmCallRecord,
  ProcessedCounts,
} from "./usage-port.js";

/**
 * project.usage — LLM-call accounting. The runner logs each completion here
 * rather than issuing a bespoke `pipeline.llm_calls` insert.
 */
/// todo: We should not have teese forward classes. we can pass the UsagePort directly to the project.usage. The Usage class is not needed.
export class Usage {
  constructor(private readonly port: UsagePort) {}

  logLlmCall(record: LlmCallRecord): Promise<void> {
    return this.port.logLlmCall(record);
  }

  processedCounts(): Promise<ProcessedCounts> {
    return this.port.processedCounts();
  }
}
