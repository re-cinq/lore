import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "infra", "check-secrets.sh");

test("check-secrets.sh catches an empty dockerconfigjson password", () => {
  const tmpDir = join(repoRoot, "tmp-test-mocks");

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir);

  const kubectlMock = join(tmpDir, "kubectl");

  writeFileSync(kubectlMock, `#!/usr/bin/env bash
if [[ "$*" == *"get externalsecrets"* ]]; then
  cat << 'JSON'
{
  "items": [
    {
      "metadata": { "namespace": "default", "name": "pull-secret" },
      "spec": {
        "target": { "name": "pull-secret", "template": { "type": "kubernetes.io/dockerconfigjson" } },
        "data": [ { "remoteRef": { "key": "ghcr-token" } } ]
      }
    }
  ]
}
JSON
elif [[ "$*" == *"get pods"* ]]; then
  echo '{"items":[]}'
elif [[ "$*" == *"get secret "* || "$*" == *"get secrets "* ]]; then
  # Return a mock secret with an empty password in the dockerconfigjson
  # eyJhdXRocyI6IHsiZ2hjci5pbyI6IHsiYXV0aCI6ICJkWE5sY2pwPSJ9fX0=
  # {"auths": {"ghcr.io": {"auth": "dXNlcjo="}}}
  # dXNlcjo= is "user:" (empty password)
  cat << 'JSON'
{
  "apiVersion": "v1",
  "kind": "Secret",
  "metadata": { "name": "pull-secret", "namespace": "default" },
  "type": "kubernetes.io/dockerconfigjson",
  "data": {
    ".dockerconfigjson": "eyJhdXRocyI6IHsiZ2hjci5pbyI6IHsiYXV0aCI6ICJkWE5sY2pwPSJ9fX0="
  }
}
JSON
else
  echo '{"items": []}'
fi
`);
  chmodSync(kubectlMock, 0o755);

  const gcloudMock = join(tmpDir, "gcloud");

  writeFileSync(gcloudMock, `#!/usr/bin/env bash
if [[ "$*" == *"secrets list"* ]]; then
  echo "ghcr-token"
elif [[ "$*" == *"versions list"* ]]; then
  echo "2026-01-01T00:00:00Z"
else
  exit 0
fi
`);
  chmodSync(gcloudMock, 0o755);

  const env = { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` };

  const { status, stdout, stderr } = spawnSync("bash", [scriptPath], { env, encoding: "utf8" });
  
  rmSync(tmpDir, { recursive: true, force: true });

  assert.equal(
    status,
    1,
    `expected check-secrets.sh to exit 1 for malformed dockerconfigjson, got ${status}. Output:\n${stdout}\n${stderr}`
  );
  assert.match(
    stdout + stderr,
    /empty token|empty password|invalid auth/i,
    "expected script output to mention an empty token, empty password, or invalid auth"
  );
});

test("check-secrets.sh catches an expired dockerconfigjson token via curl", () => {
  const tmpDir = join(repoRoot, "tmp-test-mocks-2");

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir);

  const kubectlMock = join(tmpDir, "kubectl");

  writeFileSync(kubectlMock, `#!/usr/bin/env bash
if [[ "$*" == *"get externalsecrets"* ]]; then
  cat << 'JSON'
{
  "items": [
    {
      "metadata": { "namespace": "default", "name": "pull-secret" },
      "spec": {
        "target": { "name": "pull-secret", "template": { "type": "kubernetes.io/dockerconfigjson" } },
        "data": [ { "remoteRef": { "key": "ghcr-token" } } ]
      }
    }
  ]
}
JSON
elif [[ "$*" == *"get pods"* ]]; then
  echo '{"items":[]}'
elif [[ "$*" == *"get secret "* || "$*" == *"get secrets "* ]]; then
  # Return a mock secret with a valid-looking but expired token
  # dXNlcjp0b2tlbg== is "user:token"
  # eyJhdXRocyI6IHsiZ2hjci5pbyI6IHsiYXV0aCI6ICJkWE5sYcmpwRzlyWlc0PSJ9fX0=
  cat << 'JSON'
{
  "apiVersion": "v1",
  "kind": "Secret",
  "metadata": { "name": "pull-secret", "namespace": "default" },
  "type": "kubernetes.io/dockerconfigjson",
  "data": {
    ".dockerconfigjson": "eyJhdXRocyI6IHsiZ2hjci5pbyI6IHsiYXV0aCI6ICJkWE5sYcmpwRzlyWlc0PSJ9fX0="
  }
}
JSON
else
  echo '{"items": []}'
fi
`);
  chmodSync(kubectlMock, 0o755);

  const gcloudMock = join(tmpDir, "gcloud");

  writeFileSync(gcloudMock, `#!/usr/bin/env bash
if [[ "$*" == *"secrets list"* ]]; then
  echo "ghcr-token"
elif [[ "$*" == *"versions list"* ]]; then
  echo "2026-01-01T00:00:00Z"
else
  exit 0
fi
`);
  chmodSync(gcloudMock, 0o755);

  const curlMock = join(tmpDir, "curl");

  writeFileSync(curlMock, `#!/usr/bin/env bash
# Simulate a 401 Unauthorized from the registry
if [[ "$*" == *"ghcr.io/token"* ]]; then
  echo '{"errors":[{"code":"UNAUTHORIZED","message":"authentication required"}]}'
  exit 22
else
  exit 0
fi
`);
  chmodSync(curlMock, 0o755);

  const env = { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` };

  const { status, stdout, stderr } = spawnSync("bash", [scriptPath], { env, encoding: "utf8" });
  
  rmSync(tmpDir, { recursive: true, force: true });

  assert.equal(
    status,
    1,
    `expected check-secrets.sh to exit 1 for expired token, got ${status}. Output:\n${stdout}\n${stderr}`
  );
  assert.match(
    stdout + stderr,
    /expired|unauthorized|401|invalid/i,
    "expected script output to mention an expired token or unauthorized"
  );
});
