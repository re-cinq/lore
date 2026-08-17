import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

/**
 * The redirects exist for links this app cannot reach: GitHub Issues, PR bodies
 * and check-run summaries posted before a rename. Nothing else in the suite
 * touches `next.config`, so without this the entries could be dropped in a
 * refactor and the only symptom would be 404s on links already in the wild.
 */
async function redirects() {
  return (await nextConfig.redirects?.()) ?? [];
}

function destinationOf(
  source: string,
  rules: { source: string; destination: string }[],
) {
  return rules.find((r) => r.source === source)?.destination;
}

describe("legacy route redirects", () => {
  it("sends /assembly-lines/<id> to the same id under /assembly-runs", async () => {
    expect(destinationOf("/assembly-lines/:path*", await redirects())).toBe(
      "/assembly-runs/:path*",
    );
  });

  it("sends the bare /assembly-lines to /assembly-runs", async () => {
    expect(destinationOf("/assembly-lines", await redirects())).toBe(
      "/assembly-runs",
    );
  });

  it("sends /pipeline straight to /assembly-runs rather than through /assembly-lines", async () => {
    // A chain costs an extra round trip and breaks the day the middle hop goes.
    expect(destinationOf("/pipeline/:path*", await redirects())).toBe(
      "/assembly-runs/:path*",
    );
    expect(destinationOf("/pipeline", await redirects())).toBe(
      "/assembly-runs",
    );
  });

  it("keeps every legacy redirect non-permanent so a path can move again", async () => {
    // A 301 is cached by browsers indefinitely and cannot be taken back.
    expect((await redirects()).every((r) => r.permanent === false)).toBe(true);
  });
});
