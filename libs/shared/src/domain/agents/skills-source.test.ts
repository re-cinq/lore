import { describe, it, expect } from "vitest";
import { adjustsSkillModels, skillsSourceWith } from "./skills-source.js";

describe("adjustsSkillModels", () => {
  it("returns true when the source is https://gw/skills", () => {
    expect(adjustsSkillModels("https://gw/skills")).toBe(true);
  });

  it("returns false when the source is https://gw/skills/verbatim", () => {
    expect(adjustsSkillModels("https://gw/skills/verbatim")).toBe(false);
  });

  it("returns false when the source is https://gw/skills/verbatim/", () => {
    expect(adjustsSkillModels("https://gw/skills/verbatim/")).toBe(false);
  });

  it("returns true when the source is missing", () => {
    expect(adjustsSkillModels(undefined)).toBe(true);
  });

  it("returns true when the source is null", () => {
    expect(adjustsSkillModels(null)).toBe(true);
  });
});

describe("skillsSourceWith", () => {
  it("appends /verbatim to https://gw/skills when adjusting is off", () => {
    expect(skillsSourceWith("https://gw/skills", { adjust: false })).toBe(
      "https://gw/skills/verbatim",
    );
  });

  it("keeps https://gw/skills/verbatim when adjusting is off", () => {
    expect(
      skillsSourceWith("https://gw/skills/verbatim", { adjust: false }),
    ).toBe("https://gw/skills/verbatim");
  });

  it("appends /verbatim after the slash of https://gw/skills/ when adjusting is off", () => {
    expect(skillsSourceWith("https://gw/skills/", { adjust: false })).toBe(
      "https://gw/skills/verbatim",
    );
  });

  it("strips /verbatim from https://gw/skills/verbatim when adjusting is on", () => {
    expect(
      skillsSourceWith("https://gw/skills/verbatim", { adjust: true }),
    ).toBe("https://gw/skills");
  });

  it("keeps https://gw/skills when adjusting is on", () => {
    expect(skillsSourceWith("https://gw/skills", { adjust: true })).toBe(
      "https://gw/skills",
    );
  });
});
