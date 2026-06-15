import { describe, it, expect } from "vitest";
import { classifyFile } from "./content-classify.js";

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
    expect(classifyFile("web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx")).toBe("code");
    expect(classifyFile("web-ui/src/app/specs/[...path]/page.tsx")).toBe("code");
  });

  it("classifies a source file under a nested adrs/ or runbooks/ dir as code", () => {
    expect(classifyFile("agent/src/adrs/loader.ts")).toBe("code");
    expect(classifyFile("scripts/runbooks/rotate.sh")).toBe("code");
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

  it("classifies other markdown / yaml as doc and skips binaries/unknowns", () => {
    expect(classifyFile("README.md")).toBe("doc");
    expect(classifyFile("config.yaml")).toBe("doc");
    expect(classifyFile("logo.png")).toBeNull();
    expect(classifyFile("data.bin")).toBeNull();
  });
});
