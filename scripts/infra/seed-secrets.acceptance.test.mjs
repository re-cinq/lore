import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeFileSync,
  chmodSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "infra", "seed-secrets.sh");

function writeGcloudMock(tmpDir) {
  const gcloudMock = join(tmpDir, "gcloud");

  writeFileSync(
    gcloudMock,
    `#!/usr/bin/env bash
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
`,
  );
  chmodSync(gcloudMock, 0o755);
}

test("A multi-line GitHub App PEM is stored whole and cannot become values for subsequent secrets", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-seed-secrets-test-"));

  try {
    writeGcloudMock(tmpDir);

    const env = {
      ...process.env,
      PATH: `${tmpDir}:${process.env.PATH}`,
      TMPDIR: tmpDir,
    };

    const input = `-----BEGIN PEM-----
line2
-----END PEM-----
123456
`;

    const { status, stdout, stderr } = spawnSync("bash", [scriptPath], {
      env,
      input,
      encoding: "utf8",
    });

    assert.equal(
      status,
      0,
      `Expected seed-secrets.sh to exit 0, got ${status}:\n${stdout}\n${stderr}`,
    );
    assert.equal(
      existsSync(join(tmpDir, "seeded-lore-github-app-id")),
      false,
      "Existing enabled secret must remain untouched",
    );

    const privateKeyFile = join(
      tmpDir,
      "seeded-lore-github-app-private-key",
    );
    const installationIdFile = join(
      tmpDir,
      "seeded-lore-github-app-installation-id",
    );

    const privateKeySeeded = existsSync(privateKeyFile)
      ? readFileSync(privateKeyFile, "utf8")
      : "";
    const installationIdSeeded = existsSync(installationIdFile)
      ? readFileSync(installationIdFile, "utf8")
      : "";

    const expectedPem = `-----BEGIN PEM-----\nline2\n-----END PEM-----`;

    assert.equal(
      privateKeySeeded.trim(),
      expectedPem.trim(),
      `Multi-line PEM was not stored whole. Output:\n${stdout}\n${stderr}`,
    );

    assert.equal(
      installationIdSeeded.trim(),
      "123456",
      `Subsequent secret received spilled lines from the PEM. Output:\n${stdout}\n${stderr}`,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Empty required containers fail the check; existing enabled versions remain untouched", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-seed-secrets-check-"));

  try {
    writeGcloudMock(tmpDir);

    const env = {
      ...process.env,
      PATH: `${tmpDir}:${process.env.PATH}`,
      TMPDIR: tmpDir,
    };

    const { status, stdout, stderr } = spawnSync(
      "bash",
      [scriptPath, "--check"],
      {
        env,
        encoding: "utf8",
      },
    );

    assert.equal(
      status,
      1,
      `Expected seed-secrets.sh --check to exit 1 when required containers are empty, got ${status}:\n${stdout}\n${stderr}`,
    );
    assert.match(
      stdout + stderr,
      /lore-github-app-private-key — NO ENABLED VERSION/,
      "Expected check output to report empty required secret container",
    );
    assert.equal(
      existsSync(join(tmpDir, "seeded-lore-github-app-id")),
      false,
      "Existing enabled secret must remain untouched during --check",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
