import { describe, it, expect } from "vitest";
import {
  decideTestInterfaceCheck,
  isManifestDeclared,
  parseTestCommandManifest,
  resolveTestCommandManifest,
  substituteSelector,
} from "./test-command-manifest.js";

describe("parseTestCommandManifest", () => {
  it("normalizes a minimal valid manifest into a one-element list with defaults", () => {
    const result = parseTestCommandManifest({
      list: "npm run -s test:list-json",
      run: "npm run -s test:run-json -- {selector}",
      coverage_format: "lcov",
    });

    expect(result).toEqual([
      {
        list: "npm run -s test:list-json",
        run: "npm run -s test:run-json -- {selector}",
        coverage_format: "lcov",
        cwd: ".",
        path_prefix_strip: "",
      },
    ]);
  });

  it("drops an entry with no run command while keeping its valid siblings", () => {
    const result = parseTestCommandManifest([
      {
        list: "vitest list",
        run: "vitest run {selector}",
        coverage_format: "lcov",
      },
      { list: "vitest list", coverage_format: "lcov" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].run).toBe("vitest run {selector}");
  });

  it("accepts a run command without a {selector} placeholder as run-whole", () => {
    const [manifest] = parseTestCommandManifest({
      run: "npm run consumer",
    });

    expect(manifest).toMatchObject({ run: "npm run consumer", cwd: "." });
    expect(manifest.list).toBeUndefined();
    expect(manifest.coverage_format).toBeUndefined();
  });

  it("keeps the entry with coverage_format undefined when the value is unknown", () => {
    const [manifest] = parseTestCommandManifest({
      list: "vitest list",
      run: "vitest run {selector}",
      coverage_format: "html",
    });

    expect(manifest).toMatchObject({ run: "vitest run {selector}" });
    expect(manifest.coverage_format).toBeUndefined();
  });

  it("keeps a valid vitest entry alongside an honest whole-suite entry", () => {
    const result = parseTestCommandManifest([
      {
        list: "vitest list --reporter=json",
        run: "vitest run {selector} --coverage",
        coverage_format: "lcov",
      },
      { run: "npm run consumer" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      list: undefined,
      run: "npm run consumer",
      coverage_format: undefined,
      cwd: ".",
      path_prefix_strip: "",
    });
  });

  it("normalizes a polyglot array into one entry per manifest", () => {
    const result = parseTestCommandManifest([
      {
        list: "vitest list",
        run: "vitest run {selector}",
        coverage_format: "lcov",
        cwd: "web",
      },
      {
        list: "pytest --collect-only",
        run: "pytest {selector}",
        coverage_format: "cobertura",
        cwd: "api",
      },
    ]);

    expect(result.map((m) => m.cwd)).toEqual(["web", "api"]);
    expect(result).toHaveLength(2);
  });

  it("preserves a provided cwd and path_prefix_strip", () => {
    const [manifest] = parseTestCommandManifest({
      list: "go test ./... -list .*",
      run: "go test -run {selector} -coverprofile=/dev/stdout ./...",
      coverage_format: "json",
      cwd: "services/api",
      path_prefix_strip: "services/api/",
    });

    expect(manifest).toMatchObject({
      cwd: "services/api",
      path_prefix_strip: "services/api/",
    });
  });
});

describe("resolveTestCommandManifest", () => {
  const settings = {
    list: "from-settings",
    run: "from-settings {selector}",
    coverage_format: "json",
  };
  const file = {
    list: "from-file",
    run: "from-file {selector}",
    coverage_format: "lcov",
  };

  it("returns null when neither settings nor file declare a manifest", () => {
    expect(resolveTestCommandManifest({})).toBeNull();
  });

  it("prefers settings over the file when both are present", () => {
    const result = resolveTestCommandManifest({ settings, file });

    expect(result?.[0].list).toBe("from-settings");
  });

  it("falls back to the file when settings are absent", () => {
    const result = resolveTestCommandManifest({ file });

    expect(result?.[0].list).toBe("from-file");
  });
});

describe("decideTestInterfaceCheck", () => {
  it("scaffolds both files when no manifest is declared", () => {
    expect(
      decideTestInterfaceCheck({
        manifestFileDeclared: false,
        settingsTestCommands: null,
      }),
    ).toEqual({
      status: "scaffold",
      files: [".lore/test-commands.yml", ".github/workflows/lore-tests.yml"],
    });
  });

  it("reports configured when the .lore/test-commands.yml file is declared", () => {
    expect(
      decideTestInterfaceCheck({
        manifestFileDeclared: true,
        settingsTestCommands: null,
      }),
    ).toEqual({ status: "configured" });
  });

  it("reports configured when settings declare test_commands without a file", () => {
    expect(
      decideTestInterfaceCheck({
        manifestFileDeclared: false,
        settingsTestCommands: {
          list: "x",
          run: "y {selector}",
          coverage_format: "json",
        },
      }),
    ).toEqual({ status: "configured" });
  });
});

describe("isManifestDeclared", () => {
  it("returns false when neither a file nor settings declare a manifest", () => {
    expect(isManifestDeclared({})).toBe(false);
  });
});

describe("substituteSelector", () => {
  it("replaces every {selector} placeholder with the runner-native id", () => {
    expect(
      substituteSelector(
        "vitest run {selector} --coverage",
        "a.test.ts::keeps {selector}",
      ),
    ).toBe("vitest run a.test.ts::keeps {selector} --coverage");
  });
});
