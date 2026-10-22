import { describe, expect, it } from "vitest";
import {
  draftBody,
  findPullRequestTemplate,
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
  it("keeps the template's whole text, its guidance and checklist included, with the placeholder under each heading", () => {
    expect(draftBody(DEMO_TEMPLATE, BRANCH)).toEqual(
      `${OPENING}\n\n${DEMO_TEMPLATE.replace(/^(## .*)$/gm, `$1\n\n${PLACEHOLDER}`).trimEnd()}`,
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

function repositoryWith(files: Record<string, string>) {
  return {
    read: (path: string) => Promise.resolve(files[path] ?? null),
    list: (directory: string) =>
      Promise.resolve(
        Object.keys(files)
          .filter((path) => path.startsWith(`${directory}/`))
          .map((path) => path.slice(directory.length + 1)),
      ),
  };
}

describe("findPullRequestTemplate", () => {
  it.each([
    [".github/PULL_REQUEST_TEMPLATE.md"],
    [".github/pull_request_template.md"],
    ["PULL_REQUEST_TEMPLATE.md"],
    ["pull_request_template.md"],
    ["docs/PULL_REQUEST_TEMPLATE.md"],
    ["docs/pull_request_template.md"],
  ])("finds the template at %s", async (path) => {
    expect(
      await findPullRequestTemplate(repositoryWith({ [path]: DEMO_TEMPLATE })),
    ).toEqual(DEMO_TEMPLATE);
  });

  it("prefers .github/PULL_REQUEST_TEMPLATE.md over a root template", async () => {
    expect(
      await findPullRequestTemplate(
        repositoryWith({
          "pull_request_template.md": "## Root",
          ".github/PULL_REQUEST_TEMPLATE.md": "## Github",
        }),
      ),
    ).toEqual("## Github");
  });

  it("finds the first template of the .github/PULL_REQUEST_TEMPLATE directory by name", async () => {
    expect(
      await findPullRequestTemplate(
        repositoryWith({
          ".github/PULL_REQUEST_TEMPLATE/b.md": "## B",
          ".github/PULL_REQUEST_TEMPLATE/a.md": "## A",
        }),
      ),
    ).toEqual("## A");
  });

  it("answers null for a repository with no template", async () => {
    expect(await findPullRequestTemplate(repositoryWith({}))).toEqual(null);
  });
});
