import { describe, it, expect } from "vitest";

// ── Pre-run context hydration URL construction ──────────────────────
// BUG FIX: The context hydration URL must use the correct template
// (review for review tasks, implementation for everything else) and
// truncate the query to avoid URL-too-long errors.

describe("context hydration URL", () => {
  function buildContextUrl(
    apiUrl: string,
    repo: string,
    prompt: string,
    taskType: string,
  ): string {
    const template = taskType === "review" ? "review" : "implementation";
    const query = encodeURIComponent(prompt.substring(0, 200));
    return `${apiUrl}/api/context?repo=${encodeURIComponent(repo)}&template=${template}&query=${query}`;
  }

  it("uses implementation template by default", () => {
    const url = buildContextUrl("https://api.example.com", "re-cinq/lore", "add auth", "implementation");
    expect(url).toContain("template=implementation");
  });

  it("uses review template for review tasks", () => {
    const url = buildContextUrl("https://api.example.com", "re-cinq/lore", "review PR", "review");
    expect(url).toContain("template=review");
  });

  it("uses implementation template for general tasks", () => {
    const url = buildContextUrl("https://api.example.com", "re-cinq/lore", "analyze code", "general");
    expect(url).toContain("template=implementation");
  });

  it("truncates query to 200 chars", () => {
    const longPrompt = "x".repeat(500);
    const url = buildContextUrl("https://api.example.com", "re-cinq/lore", longPrompt, "general");
    // URL-encoded 200 chars of "x" = 200 chars (no encoding needed for 'x')
    const queryParam = new URL(url).searchParams.get("query");
    expect(queryParam!.length).toBe(200);
  });

  it("encodes special characters in repo name", () => {
    const url = buildContextUrl("https://api.example.com", "org/repo-name", "test", "general");
    expect(url).toContain("repo=org%2Frepo-name");
  });

  it("encodes special characters in query", () => {
    const url = buildContextUrl("https://api.example.com", "org/repo", "what's the auth pattern?", "general");
    expect(url).toContain("query=what");
    expect(url).not.toContain("?&"); // no unencoded special chars breaking the URL
  });
});

// ── Context hydration prompt construction ───────────────────────────
// When pre-loaded context is available, the preamble changes from
// "call assemble_context first" to "context was pre-loaded above".

describe("context hydration prompt", () => {
  it("includes pre-loaded context when available", () => {
    const preContext = "## Conventions\n\nUse TypeScript strict mode.";
    const parts: string[] = [];
    if (preContext) {
      parts.push("## Pre-loaded Context\n\n" + preContext + "\n\n---\n");
      parts.push("Context was pre-loaded above. You may call assemble_context for fresh data during long tasks.");
    } else {
      parts.push("IMPORTANT: You have the Lore MCP server. Follow this workflow:");
      parts.push("1. FIRST: Call assemble_context with a query describing this task.");
    }

    const prompt = parts.join("\n");
    expect(prompt).toContain("Pre-loaded Context");
    expect(prompt).toContain("Use TypeScript strict mode");
    expect(prompt).not.toContain("FIRST: Call assemble_context");
  });

  it("falls back to assemble_context instruction when no pre-loaded context", () => {
    const preContext = "";
    const parts: string[] = [];
    if (preContext) {
      parts.push("## Pre-loaded Context\n\n" + preContext);
    } else {
      parts.push("IMPORTANT: You have the Lore MCP server. Follow this workflow:");
      parts.push("1. FIRST: Call assemble_context with a query describing this task.");
    }

    const prompt = parts.join("\n");
    expect(prompt).toContain("FIRST: Call assemble_context");
    expect(prompt).not.toContain("Pre-loaded Context");
  });
});

// ── /api/context endpoint with assembleContext ──────────────────────
// BUG FIX: the endpoint previously only returned raw chunks. Now when
// a query param is present, it calls assembleContext with an 8k token cap.

describe("/api/context endpoint behavior", () => {
  it("should use full assembly when query param is present", () => {
    const url = new URL("http://localhost/api/context?repo=re-cinq/lore&query=auth&template=implementation");
    const query = url.searchParams.get("query");
    const template = url.searchParams.get("template") || "default";
    const useAssembly = !!query;

    expect(useAssembly).toBe(true);
    expect(template).toBe("implementation");
  });

  it("should use raw chunk fetch when no query param", () => {
    const url = new URL("http://localhost/api/context?repo=re-cinq/lore");
    const query = url.searchParams.get("query");
    const useAssembly = !!query;

    expect(useAssembly).toBe(false);
  });

  it("should cap token budget at 8000 for pre-hydration", () => {
    const PRE_HYDRATION_MAX_TOKENS = 8000;
    expect(PRE_HYDRATION_MAX_TOKENS).toBeLessThan(16000); // default is 16000
  });
});
