import { describe, it, expect } from "vitest";
import { runCredentialKey } from "./run-credential-key.js";

describe("runCredentialKey", () => {
  it("derives eef1993b…00f6df from ingest token ingest-token-for-tests, a domain-separated HMAC rather than the token itself", () => {
    expect(
      runCredentialKey({ LORE_INGEST_TOKEN: "ingest-token-for-tests" }),
    ).toBe("eef1993b833752a510a8c6078e3a7f04c6fc8f0b6e61802fc5c7b5354300f6df");
  });

  it("refuses to derive a key when LORE_INGEST_TOKEN is unset, naming the variable", () => {
    expect(() => runCredentialKey({})).toThrow(
      new Error(
        "LORE_INGEST_TOKEN is not set — lore-api cannot sign run credentials without it",
      ),
    );
  });
});
