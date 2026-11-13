export type Harness = "claude" | "gemini" | "codex" | "opencode";

// Mirrors vendorOf in the agent subsystem (core/vendor.d): the CLI a model name runs on.
export function harnessOfModel(model: string): Harness {
  const name = model.trim().toLowerCase();

  if (name.includes("opencode")) {
    return "opencode";
  }

  if (name.includes("gemini")) {
    return "gemini";
  }

  if (name.includes("codex") || /^(gpt|o1|o3|o4)/.test(name)) {
    return "codex";
  }

  return "claude";
}
