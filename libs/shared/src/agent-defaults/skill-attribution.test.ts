import { describe, expect, it } from "vitest";
import {
  attributionFactsOf,
  attributionSectionOf,
  hasCompleteAttribution,
} from "./skill-attribution.js";

const MIT_SECTION = `Adapted from the \`functional\` skill in [citypaul/.dotfiles](https://github.com/citypaul/.dotfiles/tree/main/claude/.claude/skills/functional), Copyright (c) 2024 Paul Hammond, MIT licence. Modified by re:cinq: made a single file.`;

describe("attributionSectionOf", () => {
  it("returns the text between Attribution and Help when Attribution sits directly before Help", () => {
    const content = `# Title\n\nbody\n\n## Attribution\n\nAdapted from X.\n\n## Help\n\n<!-- lore-help:begin -->\n`;

    expect(attributionSectionOf(content)).toEqual("\nAdapted from X.\n");
  });

  it("returns undefined when another section sits between Attribution and Help", () => {
    const content = `## Attribution\n\nAdapted from X.\n\n## Notes\n\ntext\n\n## Help\n`;

    expect(attributionSectionOf(content)).toBeUndefined();
  });

  it("returns undefined when there is no Attribution section", () => {
    expect(attributionSectionOf("# Title\n\n## Help\n")).toBeUndefined();
  });
});

describe("attributionFactsOf", () => {
  it("returns the url, the copyright line, MIT and the modification statement for a citypaul section", () => {
    expect(attributionFactsOf(MIT_SECTION)).toEqual({
      sourceUrls: [
        "https://github.com/citypaul/.dotfiles/tree/main/claude/.claude/skills/functional",
      ],
      creditLines: ["Copyright (c) 2024 Paul Hammond"],
      licenceIds: ["MIT"],
      statesModification: true,
    });
  });

  it("returns the authors line and CC-BY-SA-4.0 for a CC BY-SA section", () => {
    const section =
      "Original: [CLI Guidelines](https://clig.dev/). Authors: Aanand Prasad, Ben Firshman, Carl Tashian and Eva Parish. Licence: CC BY-SA 4.0 (SPDX: CC-BY-SA-4.0). Modified by re:cinq.";

    expect(attributionFactsOf(section)).toEqual({
      sourceUrls: ["https://clig.dev/"],
      creditLines: [
        "Authors: Aanand Prasad, Ben Firshman, Carl Tashian and Eva Parish",
      ],
      licenceIds: ["CC-BY-SA-4.0"],
      statesModification: true,
    });
  });

  it("returns empty facts and no modification for prose that names no source", () => {
    expect(attributionFactsOf("Thanks to everyone.")).toEqual({
      sourceUrls: [],
      creditLines: [],
      licenceIds: [],
      statesModification: false,
    });
  });
});

describe("hasCompleteAttribution", () => {
  it("returns true for a section with url, copyright, MIT and modification before Help", () => {
    expect(
      hasCompleteAttribution(`\n## Attribution\n\n${MIT_SECTION}\n\n## Help\n`),
    ).toBe(true);
  });

  it("returns false when the section names no licence", () => {
    expect(
      hasCompleteAttribution(
        "\n## Attribution\n\nFrom https://x.dev, Copyright (c) 2024 A B. Modified by re:cinq.\n\n## Help\n",
      ),
    ).toBe(false);
  });
});
