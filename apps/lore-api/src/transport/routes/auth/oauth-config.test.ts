import { describe, it, expect } from "vitest";
import { oauthConfigFrom } from "./oauth-config.js";

const ENCRYPTION_KEY = "0123456789abcdef".repeat(4);

const env = {
  GITHUB_APP_CLIENT_ID: "Iv1.app-client-1",
  GITHUB_APP_CLIENT_SECRET: "app-secret-1",
  GITHUB_APP_ID: "99999",
  GITHUB_OAUTH_CLIENT_ID: "oauth-client-1",
  GITHUB_OAUTH_CLIENT_SECRET: "oauth-secret-1",
  LORE_API_URL: "https://lore-api.example/",
  LORE_UI_URL: "https://lore.example",
  GITHUB_ORG: "re-cinq",
  LORE_USER_TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
};

describe("oauthConfigFrom", () => {
  it("reads the GitHub App client credentials, token encryption key, public API address, UI and org from the environment", () => {
    expect(oauthConfigFrom(env)).toEqual({
      clientId: "Iv1.app-client-1",
      clientSecret: "app-secret-1",
      apiUrl: "https://lore-api.example",
      uiUrl: "https://lore.example",
      org: "re-cinq",
      tokenEncryptionKey: ENCRYPTION_KEY,
    });
  });

  it("returns null when the GitHub App client id is missing", () => {
    expect(
      oauthConfigFrom({ ...env, GITHUB_APP_CLIENT_ID: undefined }),
    ).toBeNull();
  });

  it("returns null when the GitHub App client secret is empty", () => {
    expect(
      oauthConfigFrom({ ...env, GITHUB_APP_CLIENT_SECRET: "" }),
    ).toBeNull();
  });

  it("returns null when the public API address is missing", () => {
    expect(oauthConfigFrom({ ...env, LORE_API_URL: undefined })).toBeNull();
  });

  it("returns null when the user token encryption key is missing", () => {
    expect(
      oauthConfigFrom({ ...env, LORE_USER_TOKEN_ENCRYPTION_KEY: undefined }),
    ).toBeNull();
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
