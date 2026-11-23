import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

async function headersOnEveryPath(): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const everyPath = rules.find((rule) => rule.source === "/:path*");

  return Object.fromEntries(
    (everyPath?.headers ?? []).map(({ key, value }) => [key, value]),
  );
}

describe("the UI's response headers", () => {
  it("sends every page with nosniff, no framing, a strict referrer and HSTS", async () => {
    expect(await headersOnEveryPath()).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Strict-Transport-Security": "max-age=31536000",
    });
  });

  it("sends every page with a policy that forbids plugins and a foreign base url", async () => {
    expect((await headersOnEveryPath())["Content-Security-Policy"]).toBe(
      "base-uri 'self'; object-src 'none'",
    );
  });

  it("turns off camera, microphone, location, payment and USB for every page", async () => {
    expect((await headersOnEveryPath())["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
  });

  it("keeps every page out of search indexes", async () => {
    expect((await headersOnEveryPath())["X-Robots-Tag"]).toBe(
      "noindex, nofollow",
    );
  });
});
