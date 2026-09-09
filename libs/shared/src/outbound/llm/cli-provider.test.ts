import { describe, it, expect } from "vitest";
import { CliProvider } from "./cli-provider.js";

describe("CliProvider", () => {
  it("shells out to `claude -p`, billing the subscription not API credits, with the combined system+user prompt and returns trimmed stdout", async () => {
    let captured: { file: string; args: string[] } | null = null;
    const execFn = async (file: string, args: string[]) => {
      captured = { file, args };

      return { stdout: "the answer\n" };
    };
    const provider = new CliProvider({ execFn });

    const result = await provider.complete({
      prompt: "user-text",
      systemPrompt: "sys",
    });

    expect(captured).toEqual({
      file: "claude",
      args: ["-p", "sys\n\nuser-text", "--output-format", "text"],
    });
    expect(result.text).toBe("the answer");
    expect(result.model).toBe("claude-cli");
  });
});
