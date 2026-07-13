import { describe, it, expect } from "vitest";
import { pickSchema, ORG_SHARED_SCHEMA } from "./repo-schema";

describe("pickSchema", () => {
  it("returns the team's own schema when it is provisioned", () => {
    expect(pickSchema("platform", ["platform", "org_shared"])).toBe("platform");
  });

  it("returns org_shared when the team schema is not provisioned", () => {
    expect(pickSchema("platform", ["org_shared"])).toBe("org_shared");
  });

  it("returns org_shared when team is null", () => {
    expect(pickSchema(null, ["platform", "org_shared"])).toBe("org_shared");
  });

  it("returns org_shared when team is an empty string", () => {
    expect(pickSchema("", ["org_shared"])).toBe("org_shared");
  });

  it("returns org_shared when team is not a valid schema identifier", () => {
    expect(pickSchema("Platform", ["Platform", "org_shared"])).toBe(
      "org_shared",
    );
  });

  it("returns org_shared for an injection-shaped team value present in the list", () => {
    expect(
      pickSchema("public; drop schema lore", ["public; drop schema lore"]),
    ).toBe("org_shared");
  });

  it("exposes org_shared as the fallback constant", () => {
    expect(ORG_SHARED_SCHEMA).toBe("org_shared");
  });
});
