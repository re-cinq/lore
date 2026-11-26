// @vitest-environment node

import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/version", () => {
  it("answers the build sha, the release tag and the planning packages baked in at build time", async () => {
    vi.stubEnv("LORE_UI_VERSION", "abc1234");
    vi.stubEnv("LORE_UI_PACKAGES", '{"@re-cinq/planning-editor":"0.16.0"}');
    vi.stubEnv("LORE_RELEASE", "v1.2.3");

    expect(await GET().json()).toEqual({
      version: "abc1234",
      release: "v1.2.3",
      packages: { "@re-cinq/planning-editor": "0.16.0" },
    });
  });

  it("answers dev, no release and no packages for a build that baked none", async () => {
    vi.stubEnv("LORE_UI_VERSION", undefined);
    vi.stubEnv("LORE_UI_PACKAGES", undefined);
    vi.stubEnv("LORE_RELEASE", undefined);

    expect(await GET().json()).toEqual({
      version: "dev",
      release: null,
      packages: {},
    });
  });
});
