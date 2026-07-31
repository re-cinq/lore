// Wraps the process-wide Llm so a station's model calls are summed for the
// terminal line's cost report without each station threading usage by hand —
// the detect family's spec-coverage-backfill judge makes its calls deep inside
// @re-cinq/lore-shared/detect where no NodeResult exists to carry them.
// Installed around every runner by runStation (main.ts).

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

  /**
   * Summed usage of every call that completed through this wrapper, undefined
   * when none did. A multi-model run keeps the first call's model — the cost
   * sink's LlmCallRow carries a single model column.
   */
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
