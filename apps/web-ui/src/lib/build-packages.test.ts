import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planningPackageVersions } from "./build-packages";

function installed(versions: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ui-packages-"));

  for (const [name, version] of Object.entries(versions)) {
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    writeFileSync(
      join(root, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  }

  return root;
}

describe("planningPackageVersions", () => {
  it("reads the versions of the two installed planning packages", () => {
    const root = installed({
      "@re-cinq/planning-document": "0.12.0",
      "@re-cinq/planning-editor": "0.16.0",
    });

    expect(planningPackageVersions(root)).toEqual({
      "@re-cinq/planning-document": "0.12.0",
      "@re-cinq/planning-editor": "0.16.0",
    });
  });

  it("leaves out a planning package that is not installed", () => {
    const root = installed({ "@re-cinq/planning-editor": "0.16.0" });

    expect(planningPackageVersions(root)).toEqual({
      "@re-cinq/planning-editor": "0.16.0",
    });
  });
});

it("pins Next.js to the exact version resolved in the UI lockfile", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { dependencies: { next: string } };
  const lockfile = JSON.parse(
    readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
  ) as { packages: { "node_modules/next": { version: string } } };

  expect(manifest.dependencies.next).toBe(
    lockfile.packages["node_modules/next"].version,
  );
});

it("resolves Next.js 16.4.5 or later, the first release with the November 2026 security fixes", () => {
  const lockfile = JSON.parse(
    readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
  ) as { packages: { "node_modules/next": { version: string } } };
  const [major, minor, patch] = lockfile.packages["node_modules/next"].version
    .split(".")
    .map(Number);

  expect(major * 1_000_000 + minor * 1_000 + patch).toBeGreaterThanOrEqual(
    16_004_005,
  );
});
