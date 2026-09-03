import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

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
    expect(destinationOf("/pipeline/:path*", await redirects())).toBe(
      "/assembly-runs/:path*",
    );
    expect(destinationOf("/pipeline", await redirects())).toBe(
      "/assembly-runs",
    );
  });

  it("keeps every legacy redirect non-permanent so a path can move again", async () => {
    expect((await redirects()).every((r) => r.permanent === false)).toBe(true);
  });
});
