import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, chmodSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "infra", "seed-secrets.sh");

test("A multi-line GitHub App PEM is stored whole and cannot become values for subsequent secrets", () => {
  const tmpDir = join(repoRoot, "tmp-test-mocks-seed");

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir);

  const gcloudMock = join(tmpDir, "gcloud");

  writeFileSync(gcloudMock, `#!/usr/bin/env bash
if [[ "$*" == *"auth print-access-token"* ]]; then
  echo "fake-token"
  exit 0
elif [[ "$*" == *"secrets describe "* ]]; then
  exit 0
elif [[ "$*" == *"versions list "* ]]; then
  if [[ "$*" == *"lore-github-app-private-key"* || "$*" == *"lore-github-app-installation-id"* ]]; then
    exit 0
  else
    echo "enabled"
  fi
elif [[ "$*" == *"versions add "* ]]; then
  # extract secret name
  for arg in "$@"; do
    if [[ "$arg" == lore-* ]]; then
      secret_name="$arg"
    fi
  done
  cat > "${tmpDir}/seeded-$secret_name"
  exit 0
else
  exit 0
fi
`);
  chmodSync(gcloudMock, 0o755);

  const env = { ...process.env, PATH: `${tmpDir}:${process.env.PATH}`, TMPDIR: tmpDir };

  // Input contains a multiline PEM, followed by a blank line, then the next secret.
  const input = `-----BEGIN PEM-----
line2
-----END PEM-----

123456

`;

  const { status, stdout, stderr } = spawnSync("bash", [scriptPath], { env, input, encoding: "utf8" });
  
  const privateKeyFile = join(tmpDir, "seeded-lore-github-app-private-key");
  const installationIdFile = join(tmpDir, "seeded-lore-github-app-installation-id");

  let privateKeySeeded = "";

  if (existsSync(privateKeyFile)) {
    privateKeySeeded = readFileSync(privateKeyFile, "utf8");
  }

  let installationIdSeeded = "";

  if (existsSync(installationIdFile)) {
    installationIdSeeded = readFileSync(installationIdFile, "utf8");
  }

  rmSync(tmpDir, { recursive: true, force: true });

  const expectedPem = `-----BEGIN PEM-----\nline2\n-----END PEM-----`;

  assert.equal(
    privateKeySeeded.trim(),
    expectedPem.trim(),
    `Multi-line PEM was not stored whole. Output:\n${stdout}\n${stderr}`
  );

  assert.equal(
    installationIdSeeded.trim(),
    "123456",
    `Subsequent secret received spilled lines from the PEM. Output:\n${stdout}\n${stderr}`
  );
});
