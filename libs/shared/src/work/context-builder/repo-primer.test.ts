import { describe, expect, it } from "vitest";
import { FakeLlm } from "../../outbound/llm/fake-llm.js";
import { writePrimer } from "./repo-primer.js";

const TREE = ["README.md", "apps/api/src/server.ts", "specs/chat/spec.md"];

describe("writePrimer", () => {
  it("lists the top-level entries without asking the model when the repository has no CLAUDE.md, AGENTS.md or README", async () => {
    const llm = new FakeLlm({ text: "invented" });

    const primer = await writePrimer(llm, { documents: [], tree: TREE });

    expect(primer).toBe(
      "(No CLAUDE.md, AGENTS.md or README. Top-level entries: README.md, apps, specs)",
    );
    expect(llm.calls).toEqual([]);
  });

  it("asks the model for a primer from CLAUDE.md alone, telling it to state only what the file says", async () => {
    const llm = new FakeLlm({ text: "  Otto is OLT's support agent.  " });

    const primer = await writePrimer(llm, {
      documents: [{ name: "CLAUDE.md", text: "# Otto\nNever log content." }],
      tree: TREE,
    });

    expect(primer).toBe("Otto is OLT's support agent.");
    expect(llm.calls[0]).toMatchObject({
      prompt: expect.stringContaining(
        "## CLAUDE.md\n# Otto\nNever log content.",
      ),
      systemPrompt: expect.stringContaining("never infer a rule"),
    });
  });
});
