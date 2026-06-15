/**
 * A provider that refuses to do anything. Installed as the global default in
 * test setup so a path that is supposed to be deterministic proves it: the
 * moment it calls the model seam, the test throws. Production never uses this.
 */

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
