import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `platform-github.ts` reaches libsodium through `const spec = "libsodium-wrappers";
 * await import(spec)` — an indirection that exists to dodge type resolution and, as a
 * side effect, hides the import from every static dependency checker. The package is a
 * production runtime requirement of `setRepoSecret`, which encrypts the ingest token
 * before uploading it as a GitHub Actions secret during onboarding.
 *
 * It was declared only as a devDependency, surviving in the Floor image purely because
 * that Dockerfile's `npm ci` omits `--omit=dev`. This asserts the declaration is a real
 * dependency so a routine image-slimming change cannot silently break onboarding.
 */
const packageJson = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("runtime dependencies hidden behind a dynamic import", () => {
  it("declares libsodium-wrappers in dependencies", () => {
    expect(packageJson.dependencies?.["libsodium-wrappers"]).toMatch(/\d+\./);
  });

  it("does not declare libsodium-wrappers in devDependencies", () => {
    expect(packageJson.devDependencies?.["libsodium-wrappers"]).toBeUndefined();
  });

  it("resolves libsodium-wrappers with the five API members setRepoSecret uses", async () => {
    const sodium = (
      (await import("libsodium-wrappers")) as unknown as {
        default: Record<string, unknown> & {
          ready: Promise<void>;
          base64_variants?: { ORIGINAL?: number };
        };
      }
    ).default;

    await sodium.ready;

    expect({
      from_base64: typeof sodium.from_base64,
      from_string: typeof sodium.from_string,
      crypto_box_seal: typeof sodium.crypto_box_seal,
      to_base64: typeof sodium.to_base64,
      base64_variants_ORIGINAL: typeof sodium.base64_variants?.ORIGINAL,
    }).toEqual({
      from_base64: "function",
      from_string: "function",
      crypto_box_seal: "function",
      to_base64: "function",
      base64_variants_ORIGINAL: "number",
    });
  });
});
