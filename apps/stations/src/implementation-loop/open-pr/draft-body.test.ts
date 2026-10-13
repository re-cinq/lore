import { describe, expect, it } from "vitest";
import { draftBody } from "./draft-body.js";

const BRANCH = "lore/implementation-loop/issue-28";
const OPENING = `Opened by the Lore implementation loop from \`${BRANCH}\`.`;
const PLACEHOLDER = "_Written by the ready-for-review round._";

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

describe("draftBody", () => {
  it("carries the five ## headings of the repository's template, each over the placeholder", () => {
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

  it("carries the required three when the template has no ## heading, counting ### and # as none", () => {
    expect(draftBody("# Title\n\n### Notes\n\nfree text\n", BRANCH)).toEqual(
      draftBody(null, BRANCH),
    );
  });
});
