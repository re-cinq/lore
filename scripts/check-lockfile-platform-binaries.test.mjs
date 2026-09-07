import { test } from "node:test";
import assert from "node:assert/strict";
import { platformBinaryFindings } from "./check-lockfile-platform-binaries.mjs";

const pkg = (names) => ({
  optionalDependencies: Object.fromEntries(
    names.map((n) => [`@typescript/typescript-${n}`, "^7.0.2"]),
  ),
});

const lock = (entries) => ({
  packages: Object.fromEntries(
    Object.entries(entries).map(([path, version]) => [path, { version }]),
  ),
});

test("reports each declared binary the lockfile does not list", () => {
  // The #1500 regeneration: package.json still names the binary, the lockfile
  // written on a Linux runner kept only linux-x64.
  assert.deepEqual(
    platformBinaryFindings({
      pkg: pkg(["darwin-arm64", "linux-x64"]),
      lock: lock({
        "node_modules/@typescript/typescript-linux-x64": "7.0.2",
        "libs/shared/node_modules/typescript": "7.0.2",
      }),
    }),
    [
      "@typescript/typescript-darwin-arm64 is declared in package.json but has no entry in package-lock.json",
    ],
  );
});

test("reports a binary whose version differs from a workspace's typescript", () => {
  assert.deepEqual(
    platformBinaryFindings({
      pkg: pkg(["linux-x64"]),
      lock: lock({
        "node_modules/@typescript/typescript-linux-x64": "7.0.2",
        "libs/shared/node_modules/typescript": "7.0.2",
        "apps/floor/node_modules/typescript": "7.1.0",
      }),
    }),
    [
      "@typescript/typescript-linux-x64 resolves to 7.0.2 but apps/floor/node_modules/typescript is 7.1.0",
    ],
  );
});

test("reports nothing when every declared binary is listed at the workspaces' version", () => {
  assert.deepEqual(
    platformBinaryFindings({
      pkg: pkg(["darwin-arm64", "linux-x64"]),
      lock: lock({
        "node_modules/@typescript/typescript-darwin-arm64": "7.0.2",
        "node_modules/@typescript/typescript-linux-x64": "7.0.2",
        "libs/shared/node_modules/typescript": "7.0.2",
        "apps/floor/node_modules/typescript": "7.0.2",
      }),
    }),
    [],
  );
});

test("ignores the root typescript that typescript-eslint keeps at another major", () => {
  assert.deepEqual(
    platformBinaryFindings({
      pkg: pkg(["linux-x64"]),
      lock: lock({
        "node_modules/@typescript/typescript-linux-x64": "7.0.2",
        "node_modules/typescript": "5.9.3",
        "libs/shared/node_modules/typescript": "7.0.2",
      }),
    }),
    [],
  );
});

test("reports a package.json that declares no platform binary at all", () => {
  // Without this the guard goes vacuous the moment someone deletes the block.
  assert.deepEqual(platformBinaryFindings({ pkg: {}, lock: lock({}) }), [
    "package.json declares no @typescript/typescript-* optionalDependencies; the guard has nothing to check",
  ]);
});

test("ignores a third-party dependency's own nested typescript", () => {
  assert.deepEqual(
    platformBinaryFindings({
      pkg: pkg(["linux-x64"]),
      lock: lock({
        "node_modules/@typescript/typescript-linux-x64": "7.0.2",
        "node_modules/some-tool/node_modules/typescript": "5.4.5",
        "libs/shared/node_modules/typescript": "7.0.2",
      }),
    }),
    [],
  );
});

test("ignores a third-party typescript nested inside a workspace", () => {
  assert.deepEqual(
    platformBinaryFindings({
      pkg: pkg(["linux-x64"]),
      lock: lock({
        "node_modules/@typescript/typescript-linux-x64": "7.0.2",
        "apps/floor/node_modules/some-tool/node_modules/typescript": "5.4.5",
        "apps/floor/node_modules/typescript": "7.0.2",
      }),
    }),
    [],
  );
});
