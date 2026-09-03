// Wraps Llm to sum model calls for terminal cost report without manual threading.

import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
  LlmUsage,
} from "@re-cinq/lore-shared/llm/llm-provider.js";
import type { NodeLlmUsage } from "@re-cinq/lore-assembly-lines";

export class UsageTrackingLlm implements LlmProvider {
  readonly vendor: string;
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;
  private durationMs = 0;
  private model = "";

  constructor(readonly inner: LlmProvider) {
    this.vendor = inner.vendor;
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const completion = await this.inner.complete(req);

    this.track(completion);

    return completion;
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    const result = await this.inner.completeWithTool<T>(req);

    this.track(result);

    return result;
  }

  /** Summed usage of all completed calls (undefined if none). */
  totalUsage(): NodeLlmUsage | undefined {
    if (this.calls === 0) {
      return undefined;
    }

    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsd: this.costUsd,
      durationMs: this.durationMs,
      model: this.model,
    };
  }

  private track(usage: LlmUsage): void {
    this.calls++;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.costUsd += usage.costUsd;
    this.durationMs += usage.durationMs;
    this.model ||= usage.model;
  }
}
