import { enforceTrue } from "../../lib/enforce.js";
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

function findRepoRoot(startUrl: string): string {
  let dir = path.dirname(fileURLToPath(startUrl));

  for (;;) {
    const hasInfra = existsSync(path.join(dir, "infra"));
    const hasWorkflows = existsSync(path.join(dir, ".github"));

    if (hasInfra && hasWorkflows) {
      return dir;
    }
    const parent = path.dirname(dir);

    enforceTrue(
      parent !== dir,
      Error,
      "repo root containing both infra/ and .github/ was not found above the test file",
    );
    dir = parent;
  }
}

function read(file: string): string {
  enforceTrue(
    existsSync(file),
    Error,
    `security-posture: expected infra manifest is missing — ${file}`,
  );

  return readFileSync(file, "utf8");
}

function walkFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...walkFiles(full));
      continue;
    }

    if (entry.isFile()) {
      found.push(full);
    }
  }

  return found;
}

const repoRoot = findRepoRoot(import.meta.url);
const chartsDir = path.join(
  repoRoot,
  "infra/terraform/modules/gke-mcp/lore-platform/charts",
);
const workflowsDir = path.join(repoRoot, ".github/workflows");

describe("Workload Identity binding, no long-lived key material (infra charts)", () => {
  const chartFiles = walkFiles(chartsDir);

  it("at least one chart annotates a KSA with iam.gke.io/gcp-service-account", () => {
    const annotated = chartFiles.filter((file) =>
      read(file).includes("iam.gke.io/gcp-service-account"),
    );

    expect(annotated.length).toBeGreaterThan(0);
  });

  it("no chart embeds a PEM private key or a credentials.json reference", () => {
    const pemPrivateKey = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
    const offenders = chartFiles.filter((file) => {
      const text = read(file);

      return pemPrivateKey.test(text) || text.includes("credentials.json");
    });

    expect(offenders).toEqual([]);
  });
});

describe("Workload Identity Federation for GitHub Actions (.github/workflows)", () => {
  const wifWorkflows = walkFiles(workflowsDir).filter((file) =>
    read(file).includes("google-github-actions/auth"),
  );

  it("finds the WIF auth action wired into build/deploy workflows", () => {
    expect(wifWorkflows.length).toBeGreaterThan(0);
  });

  it("every WIF workflow declares workload_identity_provider and omits credentials_json", () => {
    const violations = wifWorkflows.filter((file) => {
      const text = read(file);
      const missingProvider = !text.includes("workload_identity_provider:");
      const hasStaticKey = text.includes("credentials_json:");

      return missingProvider || hasStaticKey;
    });

    expect(violations).toEqual([]);
  });
});
