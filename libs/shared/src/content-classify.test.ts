import { describe, it, expect } from "vitest";
import { classifyFile, dropIngestExcluded } from "./content-classify.js";

describe("classifyFile", () => {
  it("classifies CLAUDE.md / AGENTS.md / CODEOWNERS as doc", () => {
    expect(classifyFile("CLAUDE.md")).toBe("doc");
    expect(classifyFile("teams/platform/CLAUDE.md")).toBe("doc");
    expect(classifyFile("CODEOWNERS")).toBe("doc");
  });

  it("classifies top-level adrs/specs markdown as adr/spec", () => {
    expect(classifyFile("adrs/ADR-001.md")).toBe("adr");
    expect(classifyFile("specs/my-feature/spec.md")).toBe("spec");
    expect(classifyFile(".specify/spec.md")).toBe("spec");
  });

  it("classifies source files as code by extension", () => {
    expect(classifyFile("src/index.ts")).toBe("code");
    expect(classifyFile("main.go")).toBe("code");
    expect(classifyFile("lib/auth.py")).toBe("code");
  });

  it("classifies a .tsx/.jsx source file under a nested specs/ dir as code, not spec", () => {
    expect(classifyFile("web-ui/src/app/specs/page.tsx")).toBe("code");
    expect(
      classifyFile("web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx"),
    ).toBe("code");
    expect(classifyFile("web-ui/src/app/specs/[...path]/page.tsx")).toBe(
      "code",
    );
  });

  it("classifies a source file under a nested adrs/ or runbooks/ dir as code", () => {
    expect(classifyFile("agent/src/adrs/loader.ts")).toBe("code");
    expect(classifyFile("scripts/runbooks/rotate.sh")).toBe("code");
  });

  it("classifies a CSS module under a nested specs/ dir as code, not spec", () => {
    expect(classifyFile("web-ui/src/app/specs/SpecsListView.module.css")).toBe(
      "code",
    );
    expect(
      classifyFile(
        "apps/web-ui/src/app/repos/[owner]/[repo]/specs/TestCommandsSetup.module.css",
      ),
    ).toBe("code");
  });

  it("classifies stylesheets as code by extension", () => {
    expect(classifyFile("styles/app.css")).toBe("code");
    expect(classifyFile("theme.scss")).toBe("code");
    expect(classifyFile("vars.sass")).toBe("code");
    expect(classifyFile("legacy.less")).toBe("code");
  });

  it("still classifies a real markdown spec under a nested specs/ dir as spec", () => {
    expect(classifyFile("packages/api/specs/auth/spec.md")).toBe("spec");
  });

  it("returns code for the new tsx/jsx/mjs/cjs extensions", () => {
    expect(classifyFile("a.tsx")).toBe("code");
    expect(classifyFile("a.jsx")).toBe("code");
    expect(classifyFile("a.mjs")).toBe("code");
    expect(classifyFile("a.cjs")).toBe("code");
  });

  it("returns null for every file under graveyard/", () => {
    expect(classifyFile("graveyard/specs/5-lore-agent/spec.md")).toBeNull();
    expect(classifyFile("graveyard/adrs/ADR-011.md")).toBeNull();
    expect(classifyFile("graveyard/README.md")).toBeNull();
    expect(
      classifyFile("graveyard/agent-prompts/graphrag-build.md"),
    ).toBeNull();
  });

  it("classifies a non-root graveyard/ directory normally", () => {
    expect(classifyFile("apps/floor/graveyard/notes.md")).toBe("doc");
  });

  it("classifies other markdown / yaml as doc and skips binaries/unknowns", () => {
    expect(classifyFile("README.md")).toBe("doc");
    expect(classifyFile("config.yaml")).toBe("doc");
    expect(classifyFile("logo.png")).toBeNull();
    expect(classifyFile("data.bin")).toBeNull();
  });

  it("returns null for every file under a fixtures/ or __fixtures__/ segment", () => {
    expect(
      classifyFile(
        "tools/eslint-plugin-lore/rules/fixtures/require-spec-link/specs/foo/spec.md",
      ),
    ).toBeNull();
    expect(classifyFile("libs/shared/src/__fixtures__/sample.ts")).toBeNull();
    expect(classifyFile("__fixtures__/sample.ts")).toBeNull();
    expect(classifyFile("fixtures/adrs/ADR-001.md")).toBeNull();
  });

  it("classifies a path merely containing the word fixtures normally", () => {
    expect(classifyFile("specs/fixtures-handling/spec.md")).toBe("spec");
    expect(classifyFile("src/fixtures-loader.ts")).toBe("code");
  });
});

describe("dropIngestExcluded", () => {
  it("drops rows under fixtures/, __fixtures__/ and graveyard/ paths", () => {
    const rows = [
      {
        filePath:
          "tools/eslint-plugin-lore/rules/fixtures/require-spec-link/specs/foo/spec.md",
      },
      { filePath: "libs/shared/src/__fixtures__/sample.test.ts" },
      { filePath: "graveyard/old-spec.md" },
    ];

    expect(dropIngestExcluded(rows)).toEqual([]);
  });

  it("keeps spec and test rows on ingestible paths", () => {
    const rows = [
      { filePath: "specs/spec-test-coverage/spec.md" },
      { filePath: "libs/shared/src/content-classify.test.ts" },
      { filePath: "specs/fixtures-handling/spec.md" },
    ];

    expect(dropIngestExcluded(rows)).toEqual(rows);
  });

  it("drops rows with binary file extensions", () => {
    const rows = [
      { filePath: "assets/logo.png" },
      { filePath: "docs/report.pdf" },
    ];

    expect(dropIngestExcluded(rows)).toEqual([]);
  });
});
