// @vitest-environment node

import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/version", () => {
  it("answers the build sha and the planning packages baked in at build time", async () => {
    vi.stubEnv("LORE_UI_VERSION", "abc1234");
    vi.stubEnv("LORE_UI_PACKAGES", '{"@re-cinq/planning-editor":"0.16.0"}');

    expect(await GET().json()).toEqual({
      version: "abc1234",
      packages: { "@re-cinq/planning-editor": "0.16.0" },
    });
  });

  it("answers dev and no packages for a build that baked none", async () => {
    vi.stubEnv("LORE_UI_VERSION", undefined);
    vi.stubEnv("LORE_UI_PACKAGES", undefined);

    expect(await GET().json()).toEqual({ version: "dev", packages: {} });
  });
});
