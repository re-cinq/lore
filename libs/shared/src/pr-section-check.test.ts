import { describe, it, expect } from "vitest";
import {
  sectionIsEmpty,
  extractSection,
  stripCommentsAndWhitespace,
} from "./pr-section-check.js";

// The real PR template ships each section as a lone HTML comment placeholder,
// exactly the shape the workflow must catch as "empty".
const TEMPLATE_BODY = `## Why

<!-- What problem does this solve? What outcome does it enable? Be specific about the motivation — link to the spec, issue, or incident if one exists. -->

## What Changed

<!-- Bullet-point summary of the actual changes. -->

## Alternatives Considered

<!-- What else did you evaluate? Why did you reject it? -->

## Testing

<!-- How was this verified? -->
`;

describe("sectionIsEmpty", () => {
  it("returns true when Why holds only an HTML comment", () => {
    expect(sectionIsEmpty(TEMPLATE_BODY, "Why")).toBe(true);
  });

  it("returns true when Alternatives Considered holds only an HTML comment", () => {
    expect(sectionIsEmpty(TEMPLATE_BODY, "Alternatives Considered")).toBe(true);
  });

  it("returns true when the section is only blank lines", () => {
    const body = `## Why


## What Changed
`;

    expect(sectionIsEmpty(body, "Why")).toBe(true);
  });

  it("returns false when Why has prose", () => {
    const body = `## Why

Reconciles the workflow grep with the template heading.

## What Changed
`;

    expect(sectionIsEmpty(body, "Why")).toBe(false);
  });

  it("returns false when prose sits beside a comment", () => {
    const body = `## Alternatives Considered

<!-- prompt -->
Kept the bash workflow and added a pure mirror instead of a rewrite.

## Testing
`;

    expect(sectionIsEmpty(body, "Alternatives Considered")).toBe(false);
  });

  it("returns true when the heading is absent from the body", () => {
    const body = `## Why

Present and filled.
`;

    expect(sectionIsEmpty(body, "Alternatives Considered")).toBe(true);
  });
});

describe("extractSection", () => {
  it("returns the lines between the heading and the next section", () => {
    const body = `## Why

first line
second line

## What Changed

not included
`;

    expect(extractSection(body, "Why")).toEqual("\nfirst line\nsecond line\n");
  });

  it("returns everything after the heading when it is the last section", () => {
    const body = `## What Changed

tail line
`;

    expect(extractSection(body, "What Changed")).toEqual("\ntail line\n");
  });

  it("returns an empty string when the heading is missing", () => {
    expect(extractSection("## Why\n\ntext\n", "Testing")).toEqual("");
  });
});

describe("stripCommentsAndWhitespace", () => {
  it("removes a single-line comment and all whitespace", () => {
    expect(stripCommentsAndWhitespace("  <!-- note -->  \n\t")).toEqual("");
  });

  it("keeps prose after stripping the comment", () => {
    expect(stripCommentsAndWhitespace("<!-- c -->\nkept text")).toEqual(
      "kepttext",
    );
  });
});
