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
const chartsDir = path.join(repoRoot, "deploy/chart/charts");
const workflowsDir = path.join(repoRoot, ".github/workflows");
const clusterValues = path.join(
  repoRoot,
  "deploy/clusters/internal-cluster.values.yaml",
);

describe("Workload Identity binding, no long-lived key material (infra charts)", () => {
  const chartFiles = walkFiles(chartsDir);

  it("our GKE cluster's values annotate lore-api, lore-ui and lore-stations with iam.gke.io/gcp-service-account", () => {
    const annotated = [
      ...read(clusterValues).matchAll(
        /iam\.gke\.io\/gcp-service-account: (lore-[a-z]+)@/g,
      ),
    ].map(([, account]) => account);

    expect(annotated).toEqual(["lore-api", "lore-ui", "lore-stations"]);
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

describe("GitHub Actions hold no Google credentials (.github/workflows)", () => {
  it("no workflow carries a static key, and any Google auth names a WIF provider", () => {
    const violations = walkFiles(workflowsDir).filter((file) => {
      const text = read(file);
      const hasStaticKey = text.includes("credentials_json:");
      const authWithoutProvider =
        text.includes("google-github-actions/auth") &&
        !text.includes("workload_identity_provider:");

      return hasStaticKey || authWithoutProvider;
    });

    expect(violations).toEqual([]);
  });
});

describe("Dgraph's one pod survives node consolidation (deploy/chart)", () => {
  it("declares a PodDisruptionBudget of minAvailable 1 that selects the Dgraph pod", () => {
    const manifests = read(
      path.join(repoRoot, "deploy/chart/templates/lore-dgraph.yaml"),
    ).split(/^---$/m);
    const budget =
      manifests.find((doc) => /kind: PodDisruptionBudget/.test(doc)) ?? "";
    const statefulSet =
      manifests.find((doc) => /kind: StatefulSet/.test(doc)) ?? "";
    const [, podApp] =
      /template:\s*\n\s*metadata:\s*\n\s*labels:\s*\n\s*app: ([a-z-]+)/.exec(
        statefulSet,
      ) ?? ["", "no pod label found"];
    const [, selectedApp] =
      /selector:\s*\n\s*matchLabels: \{ app: ([a-z-]+) \}/.exec(budget) ?? [
        "",
        "no selector found",
      ];

    expect({
      minAvailable: /minAvailable: 1\b/.test(budget),
      selectedApp,
    }).toEqual({ minAvailable: true, selectedApp: podApp });
  });
});
