/**
 * A real, canned-response provider for tests. Install via
 * `Llm.setInstance(new FakeLlm({ text, data }))` to exercise an LLM-dependent
 * path without a network call or a `vi.mock`. Records the requests it received
 * for assertions.
 */

import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  durationMs: 0,
  model: "fake",
};

export class FakeLlm implements LlmProvider {
  readonly vendor = "fake";
  readonly calls: Array<LlmCompleteRequest | LlmToolRequest> = [];

  constructor(
    private readonly canned: { text?: string; data?: unknown } = {},
  ) {}

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    this.calls.push(req);

    return { text: this.canned.text ?? "", ...ZERO_USAGE };
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    this.calls.push(req);

    return { data: this.canned.data as T, ...ZERO_USAGE };
  }
}
