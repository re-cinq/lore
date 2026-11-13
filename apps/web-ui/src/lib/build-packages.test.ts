import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
