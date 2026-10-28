import { describe, it, expect } from "vitest";
import { loreApiPublicUrl } from "./lore-api-public-url";

describe("loreApiPublicUrl", () => {
  it("prefers the public address when the in-cluster one differs", () => {
    expect(
      loreApiPublicUrl({
        LORE_API_PUBLIC_URL: "https://lore-api.example",
        LORE_API_URL: "http://lore-api.lore-api.svc:3000",
      }),
    ).toBe("https://lore-api.example");
  });

  it("uses the API address when no public one is set, as on a laptop", () => {
    expect(
      loreApiPublicUrl({ LORE_API_URL: "https://lore-api.example/" }),
    ).toBe("https://lore-api.example");
  });

  it("is undefined when neither is set", () => {
    expect(loreApiPublicUrl({})).toBeUndefined();
  });
});
