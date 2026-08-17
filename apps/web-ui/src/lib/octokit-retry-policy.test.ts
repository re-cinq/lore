import { describe, it, expect } from "vitest";
// web-ui cannot import the @re-cinq/lore-shared PACKAGE (workspace + Docker
// isolation), so this policy is hand-duplicated. Following references.parity:
// import shared's PURE module by FILE PATH — never the package — so the mirror
// cannot drift behaviourally without failing here.
import { withoutBlindRetryOnCreates as mirror } from "./octokit-retry-policy";
import { withoutBlindRetryOnCreates as canonical } from "../../../../libs/shared/src/project/lib/octokit-retry-policy";

/** A client that records what the hook did to each request's options. */
function recordingClient() {
  const handlers: Array<(o: { method?: string; request?: Record<string, unknown> }) => void> = [];

  return {
    client: { hook: { before: (_n: "request", h: (typeof handlers)[number]) => handlers.push(h) } },
    /** Options as the hook leaves them for one method. */
    optionsFor(method: string) {
      const options: { method?: string; request?: Record<string, unknown> } = {
        method,
        request: { fetch: "kept" },
      };

      handlers.forEach((h) => h(options));

      return options;
    },
  };
}

const IMPLEMENTATIONS = [
  ["web-ui mirror", mirror],
  ["shared canonical", canonical],
] as const;

describe.each(IMPLEMENTATIONS)("withoutBlindRetryOnCreates (%s)", (_name, install) => {
  it("zeroes the retry budget for a POST", () => {
    const { client, optionsFor } = recordingClient();

    install(client);

    expect(optionsFor("POST").request).toEqual({ fetch: "kept", retries: 0 });
  });

  it("leaves GET, PUT, PATCH and DELETE options untouched", () => {
    const { client, optionsFor } = recordingClient();

    install(client);

    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      expect(optionsFor(method).request).toEqual({ fetch: "kept" });
    }
  });

  it("returns the same client, so construction stays one expression", () => {
    const { client } = recordingClient();

    expect(install(client)).toBe(client);
  });
});
