export interface UsagePort {
  logLlmCall(record: string): Promise<void>;
  processedCounts(): Promise<number>;
}
