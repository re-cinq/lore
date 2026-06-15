import type { UsagePort, LlmCallRecord } from "./usage-port.js";

/**
 * project.usage — LLM-call accounting. The runner logs each completion here
 * rather than issuing a bespoke `pipeline.llm_calls` insert.
 */
export class Usage {
  constructor(private readonly port: UsagePort) {}

  logLlmCall(record: LlmCallRecord): Promise<void> {
    return this.port.logLlmCall(record);
  }
}
