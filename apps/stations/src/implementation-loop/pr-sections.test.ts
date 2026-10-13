import { describe, expect, it } from "vitest";
import {
  draftBody,
  missingSections,
  requiredSections,
  withSections,
} from "./pr-sections.js";

const BRANCH = "lore/implementation-loop/issue-28";
const OPENING = `Opened by the Lore implementation loop from \`${BRANCH}\`.`;
const PLACEHOLDER = "_Written by the ready-for-review round._";
const NOT_COVERED = "_Not covered separately in this description._";

const DEMO_TEMPLATE = `## Why

<!-- Why is this change needed? Link the ticket if one exists (Closes #N). -->

## What Changed

<!-- What did you actually change? Bullet points are fine. -->

## Alternatives Considered

<!-- What other approaches did you consider and why did you rule them out? -->

## ADRs & Architecture

<!-- Does this change warrant an ADR, or does it follow an existing one? Link it here. -->

## Testing

<!-- How was this tested? Which acceptance examples are covered? -->

- [ ] \`./mvnw verify\` passes (backend tests and 80 % JaCoCo gate)
- [ ] Works with \`todo.enabled\` off
`;

describe("requiredSections", () => {
  it("reads the five ## headings of the repository's template", () => {
    expect(requiredSections(DEMO_TEMPLATE)).toEqual([
      "## Why",
      "## What Changed",
      "## Alternatives Considered",
      "## ADRs & Architecture",
      "## Testing",
    ]);
  });

  it("answers Why, What Changed and Testing for a repository with no template, and for one whose template has only # and ### headings", () => {
    expect({
      none: requiredSections(null),
      other: requiredSections("# Title\n\n### Notes\n\nfree text\n"),
    }).toEqual({
      none: ["## Why", "## What Changed", "## Testing"],
      other: ["## Why", "## What Changed", "## Testing"],
    });
  });
});

describe("draftBody", () => {
  it("carries the five headings of the repository's template, each over the placeholder", () => {
    expect(draftBody(DEMO_TEMPLATE, BRANCH)).toEqual(
      [
        OPENING,
        `## Why\n\n${PLACEHOLDER}`,
        `## What Changed\n\n${PLACEHOLDER}`,
        `## Alternatives Considered\n\n${PLACEHOLDER}`,
        `## ADRs & Architecture\n\n${PLACEHOLDER}`,
        `## Testing\n\n${PLACEHOLDER}`,
      ].join("\n\n"),
    );
  });

  it("carries Why, What Changed and Testing when the repository has no template", () => {
    expect(draftBody(null, BRANCH)).toEqual(
      [
        OPENING,
        `## Why\n\n${PLACEHOLDER}`,
        `## What Changed\n\n${PLACEHOLDER}`,
        `## Testing\n\n${PLACEHOLDER}`,
      ].join("\n\n"),
    );
  });
});

describe("missingSections", () => {
  it("names Testing as missing from a body with Why and What Changed, matching headings regardless of case and spacing", () => {
    expect(
      missingSections(
        "## why\n\ntext\n\n##   What changed  \n\ntext\n",
        requiredSections(null),
      ),
    ).toEqual(["## Testing"]);
  });

  it("names nothing missing from the draft body itself", () => {
    expect(
      missingSections(
        draftBody(DEMO_TEMPLATE, BRANCH),
        requiredSections(DEMO_TEMPLATE),
      ),
    ).toEqual([]);
  });
});

describe("withSections", () => {
  it("appends the Testing section the prose lacks over a line saying it was not covered separately", () => {
    expect(
      withSections(
        "## Why\n\nBecause.\n\n## What Changed\n\nThe thing.\n",
        requiredSections(null),
      ),
    ).toEqual(
      `## Why\n\nBecause.\n\n## What Changed\n\nThe thing.\n\n## Testing\n\n${NOT_COVERED}`,
    );
  });

  it("appends all three sections to prose written without headings", () => {
    expect(
      withSections("What changed and why.\n", requiredSections(null)),
    ).toEqual(
      `What changed and why.\n\n## Why\n\n${NOT_COVERED}\n\n## What Changed\n\n${NOT_COVERED}\n\n## Testing\n\n${NOT_COVERED}`,
    );
  });

  it("leaves prose that carries every section as it is", () => {
    const prose = "## Why\n\nA.\n\n## What Changed\n\nB.\n\n## Testing\n\nC.";

    expect(withSections(prose, requiredSections(null))).toEqual(prose);
  });
});
