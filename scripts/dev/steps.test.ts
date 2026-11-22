import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { warningsStep, type StepContext } from "./steps.ts";

const COMPLETE_SIGN_IN = {
  GITHUB_APP_CLIENT_ID: "Iv23example",
  GITHUB_APP_CLIENT_SECRET: "secret",
  LORE_USER_TOKEN_ENCRYPTION_KEY: "0".repeat(64),
};

async function signInWarnings(env: Record<string, string>): Promise<number> {
  const context: StepContext = {
    mode: { kind: "local", apiUrl: "http://localhost:3001" },
    root: os.tmpdir(),
    env,
    ports: [],
  };
  const result = await warningsStep(context).run();

  return (result?.warnings ?? []).filter((text) =>
    text.includes("GitHub App sign-in"),
  ).length;
}

describe("warningsStep", () => {
  it("warns once about sign-in when no GitHub App settings are set", async () => {
    assert.equal(await signInWarnings({}), 1);
  });

  it("warns once about sign-in when only the encryption key is missing", async () => {
    assert.equal(
      await signInWarnings({
        ...COMPLETE_SIGN_IN,
        LORE_USER_TOKEN_ENCRYPTION_KEY: "",
      }),
      1,
    );
  });

  it("warns once about sign-in when only the old OAuth App variables are set", async () => {
    assert.equal(
      await signInWarnings({
        GITHUB_OAUTH_CLIENT_ID: "id",
        GITHUB_OAUTH_CLIENT_SECRET: "secret",
      }),
      1,
    );
  });

  it("gives no sign-in warning when all three GitHub App settings are set", async () => {
    assert.equal(await signInWarnings(COMPLETE_SIGN_IN), 0);
  });
});
