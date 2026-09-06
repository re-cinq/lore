/** Refuses to do anything — installed as the test-setup default so a path meant to be deterministic throws the moment it calls the model seam. Never used in production. */

import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const REFUSAL =
  "LLM call in a no-LLM context — this path must be deterministic, or install a fake via Llm.setInstance(new FakeLlm(...))";

export class NoLlmProvider implements LlmProvider {
  readonly vendor = "none";

  complete(_req: LlmCompleteRequest): Promise<LlmCompletion> {
    return Promise.reject(new Error(REFUSAL));
  }

  completeWithTool<T>(_req: LlmToolRequest): Promise<LlmToolResult<T>> {
    return Promise.reject(new Error(REFUSAL));
  }
}
