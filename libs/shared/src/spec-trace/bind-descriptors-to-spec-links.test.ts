import { describe, it, expect } from "vitest";
import { bindDescriptorsToSpecLinks } from "./bind-descriptors-to-spec-links.js";
import { linksForStatements } from "../spec-link-parser.js";
import type { TestDescriptor } from "../test-report.js";

const SPEC_PATH = "specs/x/spec.md";
const SPEC = `# X

## Acceptance Criteria

The system greets the user.
([validated by \`greets\`](src/greet.test.ts#L10))

The system farewells the user.
([validated by \`farewells\`](src/greet.test.ts#L30))
`;

const linkedPairs = linksForStatements(SPEC).filter(
  (pair) => pair.testLinks.length > 0,
);
const greetOrdinal = linkedPairs[0].statement.ordinal;
const farewellOrdinal = linkedPairs[1].statement.ordinal;

const descriptor = (over: Partial<TestDescriptor>): TestDescriptor => ({
  id: "src/greet.test.ts::greets",
  name: "greets the user",
  file: "src/greet.test.ts",
  startLine: 8,
  endLine: 12,
  ...over,
});

const specs = [{ path: SPEC_PATH, content: SPEC }];

describe("bindDescriptorsToSpecLinks", () => {
  it("stamps the statement anchor on a descriptor whose span contains the linked line", () => {
    const [bound] = bindDescriptorsToSpecLinks([descriptor({})], specs);

    expect(bound.spec).toBe(`${SPEC_PATH}#${greetOrdinal}`);
  });

  it("returns a descriptor matching no link unchanged, with no anchor", () => {
    const [bound] = bindDescriptorsToSpecLinks(
      [descriptor({ startLine: 100, endLine: 110 })],
      specs,
    );

    expect(bound.spec).toBeUndefined();
  });

  it("leaves a descriptor that already carries a spec anchor untouched", () => {
    const [bound] = bindDescriptorsToSpecLinks(
      [descriptor({ spec: "specs/hand/spec.md#2" })],
      specs,
    );

    expect(bound.spec).toBe("specs/hand/spec.md#2");
  });

  it("returns a descriptor with no line span unchanged", () => {
    const [bound] = bindDescriptorsToSpecLinks(
      [descriptor({ startLine: undefined, endLine: undefined })],
      specs,
    );

    expect(bound.spec).toBeUndefined();
  });

  it("stamps an array of anchors when its span resolves to two distinct statements", () => {
    const [bound] = bindDescriptorsToSpecLinks(
      [descriptor({ startLine: 5, endLine: 40 })],
      specs,
    );

    expect(bound.spec).toEqual([
      `${SPEC_PATH}#${greetOrdinal}`,
      `${SPEC_PATH}#${farewellOrdinal}`,
    ]);
  });

  it("matches link paths and descriptor files after normalizing a leading ./", () => {
    const [bound] = bindDescriptorsToSpecLinks(
      [descriptor({ file: "./src/greet.test.ts" })],
      specs,
    );

    expect(bound.spec).toBe(`${SPEC_PATH}#${greetOrdinal}`);
  });

  it("resolves a ../-relative link path against the spec's directory before matching", () => {
    const nestedSpecPath = "specs/api-routes/foo/spec.md";
    const nestedSpec = `# X\n\n## Acceptance Criteria\n\nThe system greets the user.\n([validated by \`greets\`](../../../src/greet.test.ts#L10))\n`;
    const ordinal = linksForStatements(nestedSpec).filter(
      (pair) => pair.testLinks.length > 0,
    )[0].statement.ordinal;

    const [bound] = bindDescriptorsToSpecLinks(
      [descriptor({})],
      [{ path: nestedSpecPath, content: nestedSpec }],
    );

    expect(bound.spec).toBe(`${nestedSpecPath}#${ordinal}`);
  });

  it("binds nothing from a link with no #Lline anchor", () => {
    const noLineSpec = `# X\n\n## Acceptance Criteria\n\nThe system greets.\n([validated by \`greets\`](src/greet.test.ts))\n`;
    const [bound] = bindDescriptorsToSpecLinks(
      [descriptor({})],
      [{ path: SPEC_PATH, content: noLineSpec }],
    );

    expect(bound.spec).toBeUndefined();
  });
});
