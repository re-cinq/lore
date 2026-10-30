import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "./env-file.ts";

let sandbox: string;
let envFilePath: string;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), "lore-dev-env-"));
  envFilePath = path.join(sandbox, ".env.local");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("loadEnvFile", () => {
  it("returns an empty object when the file is missing", () => {
    assert.deepEqual(loadEnvFile(envFilePath), {});
  });

  it("reads plain and quoted values", () => {
    writeFileSync(envFilePath, 'A=1\nB="two words"\n# comment\nC=\n');
    assert.deepEqual(loadEnvFile(envFilePath), {
      A: "1",
      B: "two words",
      C: "",
    });
  });

  it("keeps a quoted multi-line value whole", () => {
    writeFileSync(envFilePath, 'KEY="-----BEGIN-----\nline\n-----END-----"\n');
    assert.deepEqual(loadEnvFile(envFilePath), {
      KEY: "-----BEGIN-----\nline\n-----END-----",
    });
  });

  it("expands a reference to an earlier variable like bash does", () => {
    writeFileSync(envFilePath, "A=1\nB=${A}2\n");
    assert.deepEqual(loadEnvFile(envFilePath), { A: "1", B: "12" });
  });

  it("throws naming the file when bash cannot parse it", () => {
    writeFileSync(envFilePath, 'A="unterminated\n');
    assert.throws(
      () => loadEnvFile(envFilePath),
      /could not be sourced by bash/,
    );
  });
});
