import type { UsagePort } from "./usage-port.js";

export class Usage {
  constructor(private readonly port: UsagePort) {}

  logLlmCall(record: string): Promise<void> {
    return this.port.logLlmCall(record);
  }

  processedCounts(): Promise<number> {
    return this.port.processedCounts();
  }
}
