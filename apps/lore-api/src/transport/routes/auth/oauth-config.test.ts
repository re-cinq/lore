import { describe, it, expect } from "vitest";
import { oauthConfigFrom } from "./oauth-config.js";

const env = {
  GITHUB_OAUTH_CLIENT_ID: "client-1",
  GITHUB_OAUTH_CLIENT_SECRET: "secret-1",
  LORE_API_URL: "https://lore-api.example/",
  LORE_UI_URL: "https://lore.example",
  GITHUB_ORG: "re-cinq",
};

describe("oauthConfigFrom", () => {
  it("reads the OAuth app, the public API address, the UI and the org from the environment", () => {
    expect(oauthConfigFrom(env)).toEqual({
      clientId: "client-1",
      clientSecret: "secret-1",
      apiUrl: "https://lore-api.example",
      uiUrl: "https://lore.example",
      org: "re-cinq",
    });
  });

  it("returns null when the client id is missing", () => {
    expect(
      oauthConfigFrom({ ...env, GITHUB_OAUTH_CLIENT_ID: undefined }),
    ).toBeNull();
  });

  it("returns null when the client secret is empty", () => {
    expect(
      oauthConfigFrom({ ...env, GITHUB_OAUTH_CLIENT_SECRET: "" }),
    ).toBeNull();
  });

  it("returns null when the public API address is missing", () => {
    expect(oauthConfigFrom({ ...env, LORE_API_URL: undefined })).toBeNull();
  });

  it("leaves the org and the UI unset when the environment has none", () => {
    expect(
      oauthConfigFrom({
        ...env,
        GITHUB_ORG: undefined,
        LORE_UI_URL: undefined,
      }),
    ).toMatchObject({ org: undefined, uiUrl: undefined });
  });
});
