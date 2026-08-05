import { enforceTrue } from "../lib/enforce.js";
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Drift detector for the deploy security posture. It asserts against the RAW
// text of the real infra manifests (Helm templates carry Go `{{ }}`, so YAML
// parsing them is not an option) — every property below is pinned by
// string/regex so an infra change that weakens the posture turns this suite red.

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
    } else if (entry.isFile()) {
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
const aiAgentsTemplates = path.join(chartsDir, "ai-agents-helm/templates");
const workflowsDir = path.join(repoRoot, ".github/workflows");

const controllerYaml = read(path.join(aiAgentsTemplates, "controller.yaml"));
const networkPolicyYaml = read(
  path.join(aiAgentsTemplates, "networkpolicy.yaml"),
);

describe("non-root agent pods (ai-agents controller.yaml)", () => {
  it("pod security context sets runAsNonRoot true and runAsUser 1000", () => {
    expect(controllerYaml).toMatch(/runAsNonRoot:\s*true/);
    expect(controllerYaml).toMatch(/runAsUser:\s*1000/);
  });

  it("container denies privilege escalation and drops ALL capabilities", () => {
    expect(controllerYaml).toMatch(/allowPrivilegeEscalation:\s*false/);
    expect(controllerYaml).toMatch(/capabilities:/);
    expect(controllerYaml).toMatch(/drop:\s+-\s*ALL/);
  });
});

describe("NetworkPolicy egress lockdown (ai-agents networkpolicy.yaml)", () => {
  it("declares a NetworkPolicy carrying an Egress policy type", () => {
    expect(networkPolicyYaml).toMatch(/kind:\s*NetworkPolicy/);
    expect(networkPolicyYaml).toMatch(/policyTypes:/);
    expect(networkPolicyYaml).toMatch(/-\s*Egress/);
  });

  it("permits DNS on port 53 and HTTPS on port 443 egress", () => {
    expect(networkPolicyYaml).toMatch(/port:\s*53/);
    expect(networkPolicyYaml).toMatch(/port:\s*443/);
  });
});

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
