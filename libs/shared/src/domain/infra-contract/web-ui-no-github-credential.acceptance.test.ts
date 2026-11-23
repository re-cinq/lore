import { enforceTrue } from "../../lib/enforce.js";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function findRepoRoot(startUrl: string): string {
  let dir = path.dirname(fileURLToPath(startUrl));

  for (;;) {
    if (
      existsSync(path.join(dir, "infra")) &&
      existsSync(path.join(dir, ".github"))
    ) {
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
    `web-ui-no-github-credential: expected manifest is missing — ${file}`,
  );

  return readFileSync(file, "utf8");
}

const repoRoot = findRepoRoot(import.meta.url);

describe("The web UI workload holds no GitHub credential (FR-037)", () => {
  it("mounts no GitHub credential in the ui-helm deployment and creates no GitHub Secret or ExternalSecret for lore-ui", () => {
    const uiDeployment = read(
      path.join(
        repoRoot,
        "deploy/chart/charts/ui-helm/templates/deployment.yaml",
      ),
    );
    const uiValues = read(
      path.join(repoRoot, "deploy/chart/charts/ui-helm/values.yaml"),
    );
    const installSecrets = read(
      path.join(repoRoot, "deploy/install/templates/secrets.yaml"),
    );
    const clusterValues = read(
      path.join(repoRoot, "deploy/clusters/internal-cluster.values.yaml"),
    );

    const uiDeploymentGithubEnvs = [
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_TOKEN",
    ].filter((name) => uiDeployment.includes(name));

    const installCreatesUiGithubSecret =
      installSecrets
        .split("\n")
        .some(
          (line) =>
            line.includes('"lore-ui"') && /"[^"]*github[^"]*"/i.test(line),
        ) ||
      /"namespace"\s+"lore-ui"[^)]*"name"\s+"[^"]*github[^"]*"/i.test(
        installSecrets,
      ) ||
      /"name"\s+"[^"]*github[^"]*"[^)]*"namespace"\s+"lore-ui"/i.test(
        installSecrets,
      );
    const clusterUiHasExternalGithubSecret =
      /name:\s*github-app-credentials\s*\n\s*namespace:\s*lore-ui\b/.test(
        clusterValues,
      );

    expect({
      uiDeploymentGithubEnvs,
      uiValuesHasGithubAppSecret: uiValues.includes("githubAppSecret"),
      installCreatesUiGithubSecret,
      clusterUiHasExternalGithubSecret,
    }).toEqual({
      uiDeploymentGithubEnvs: [],
      uiValuesHasGithubAppSecret: false,
      installCreatesUiGithubSecret: false,
      clusterUiHasExternalGithubSecret: false,
    });
  });
});
