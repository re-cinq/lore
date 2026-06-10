import { describe, it, expect } from "vitest";
import { splitMarkdownSections } from "./markdown-sections";

describe("splitMarkdownSections", () => {
  it("returns one section per ## heading with heading text and body including its heading line", () => {
    const source = "## Goals\n\nThe goal text.\n\n## Flows\n\nThe flow text.\n";

    expect(splitMarkdownSections(source)).toEqual([
      { heading: "Goals", body: "## Goals\n\nThe goal text.\n" },
      { heading: "Flows", body: "## Flows\n\nThe flow text.\n" },
    ]);
  });

  it("returns the content before the first ## heading as a leading section with heading null", () => {
    const source = "# Spec Title\n\nIntro paragraph.\n\n## Goals\n\nGoal text.\n";

    expect(splitMarkdownSections(source)).toEqual([
      { heading: null, body: "# Spec Title\n\nIntro paragraph.\n" },
      { heading: "Goals", body: "## Goals\n\nGoal text.\n" },
    ]);
  });
});
