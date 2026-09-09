import { describe, it, expect } from "vitest";
import { buildInstallInfo, renderInstallScript } from "./install.js";

const CONFIGURED = {
  LORE_API_URL: "https://lore-api.example.com",
  LORE_EVENT_ROUTER_PUBLIC_URL: "https://lore-events.example.com",
  LORE_CLUSTER_AGENT_REGISTRATION_TOKEN: "lcar_secret",
};

describe("buildInstallInfo", () => {
  it("is available with urls, token, and the default repo when fully configured", () => {
    expect(buildInstallInfo(CONFIGURED)).toEqual({
      available: true,
      reason: null,
      api_url: "https://lore-api.example.com",
      event_router_url: "https://lore-events.example.com",
      registration_token: "lcar_secret",
      repo_url: "https://github.com/re-cinq/lore",
    });
  });

  it("is unavailable naming every missing env var", () => {
    expect(buildInstallInfo({})).toMatchObject({
      available: false,
      reason:
        "not configured on the lore-api deployment: LORE_CLUSTER_AGENT_REGISTRATION_TOKEN (satellite registration is disabled), LORE_API_URL, LORE_EVENT_ROUTER_PUBLIC_URL",
      registration_token: null,
    });
    expect(
      buildInstallInfo({ ...CONFIGURED, LORE_EVENT_ROUTER_PUBLIC_URL: "" }),
    ).toMatchObject({
      available: false,
      reason:
        "not configured on the lore-api deployment: LORE_EVENT_ROUTER_PUBLIC_URL",
    });
  });

  it("honors a LORE_REPO_URL override", () => {
    expect(
      buildInstallInfo({ ...CONFIGURED, LORE_REPO_URL: "https://example/f" })
        .repo_url,
    ).toBe("https://example/f");
  });
});

describe("renderInstallScript", () => {
  const script = renderInstallScript(buildInstallInfo(CONFIGURED));

  it("bakes the urls and registration token as quoted exports", () => {
    expect(script).toContain(
      "export LORE_API_URL='https://lore-api.example.com'",
    );
    expect(script).toContain(
      "export EVENT_ROUTER_URL='https://lore-events.example.com'",
    );
    expect(script).toContain(
      "export LORE_CLUSTER_AGENT_REGISTRATION_TOKEN='lcar_secret'",
    );
  });

  it("prefers a local checkout and falls back to a shallow clone", () => {
    expect(script).toContain('exec scripts/install-satellite.sh "$@"');
    expect(script).toContain(
      "git clone --quiet --depth 1 'https://github.com/re-cinq/lore'",
    );
  });

  it("shell-quotes a token containing a single quote", () => {
    const tricky = renderInstallScript(
      buildInstallInfo({
        ...CONFIGURED,
        LORE_CLUSTER_AGENT_REGISTRATION_TOKEN: "a'b",
      }),
    );

    expect(tricky).toContain(
      `export LORE_CLUSTER_AGENT_REGISTRATION_TOKEN='a'\\''b'`,
    );
  });
});
