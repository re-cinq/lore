// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ChangelogView, { type Grouping } from "./ChangelogView";
import type { ChangelogPage } from "@/lib/api/changelog";
import type { ReleaseNow } from "./release-now-outcome";

const PR_3000 = {
  kind: "pr" as const,
  number: 3000,
  title: "Mirror commits",
  url: "https://github.com/re-cinq/lore/pull/3000",
  people: ["gedaiu"],
  at: "2026-10-10T10:00:00Z",
};
const PR_3055 = {
  ...PR_3000,
  number: 3055,
  title: "Make the old source the test-coverage source",
  url: "https://github.com/re-cinq/lore/pull/3055",
  people: ["alice"],
  at: "2026-10-21T10:00:00Z",
};
const V120 = {
  version: "v1.2.0",
  previousTag: "v1.1.0",
  bump: "minor" as const,
  from: "2026-10-08T11:00:00.000Z",
  to: "2026-10-15T11:00:00.000Z",
  summary: "The **Changelog** now lists releases.",
  changes: [PR_3000],
  releaseUrl: "https://github.com/re-cinq/lore/releases/tag/v1.2.0",
  publishedTo: "re-cinq/lore-public",
};
const V110 = {
  ...V120,
  version: "v1.1.0",
  bump: "patch" as const,
  releaseUrl: null,
  publishedTo: null,
  changes: [],
};
const UNRELEASED = {
  latestVersion: "v1.2.0",
  since: "2026-10-15T11:00:00.000Z",
  changes: [PR_3055],
};
const releaseNow: ReleaseNow = () =>
  Promise.resolve({ ok: true, runId: "run-7", joined: false });

function releases(page: Partial<ChangelogPage>, grouping: Grouping = "list") {
  return render(
    <ChangelogView
      base="/repos/re-cinq/lore/changelog"
      page={{
        mode: "releases",
        weeks: [],
        releases: [V120, V110],
        unreleased: UNRELEASED,
        next: null,
        ...page,
      }}
      grouping={grouping}
      writeIntro={() => Promise.resolve("")}
      releaseNow={releaseNow}
    />,
  );
}

describe("ChangelogView with releases", () => {
  it("shows v1.2.0 with its range, bump, markdown summary and change", () => {
    releases({});
    const section = screen.getByRole("region", { name: "v1.2.0" });

    expect({
      range: within(section).getByText("8 Oct – 15 Oct").textContent,
      bump: within(section).getByText("minor").textContent,
      bold: within(section).getByText("Changelog").tagName,
      change: within(section)
        .getByRole("link", { name: "Mirror commits" })
        .getAttribute("href"),
    }).toEqual({
      range: "8 Oct – 15 Oct",
      bump: "minor",
      bold: "STRONG",
      change: "https://github.com/re-cinq/lore/pull/3000",
    });
  });

  it("links the GitHub release of v1.2.0 and says it was published to re-cinq/lore-public", () => {
    releases({});
    const section = screen.getByRole("region", { name: "v1.2.0" });

    expect({
      href: within(section)
        .getByRole("link", { name: "GitHub release" })
        .getAttribute("href"),
      published: within(section).getByText("Published to re-cinq/lore-public")
        .textContent,
    }).toEqual({
      href: "https://github.com/re-cinq/lore/releases/tag/v1.2.0",
      published: "Published to re-cinq/lore-public",
    });
  });

  it("shows no GitHub release link and no publication for v1.1.0, which has neither", () => {
    releases({});
    const section = screen.getByRole("region", { name: "v1.1.0" });

    expect({
      link: within(section).queryByRole("link", { name: "GitHub release" }),
      published: within(section).queryByText(/Published to/),
    }).toEqual({ link: null, published: null });
  });

  it("groups v1.2.0's changes under gedaiu when grouped by person", () => {
    releases({}, "person");
    const section = screen.getByRole("region", { name: "v1.2.0" });

    expect(
      within(section).getByRole("heading", { name: "gedaiu" }),
    ).toBeInTheDocument();
  });

  it("shows no week title for a repo with releases", () => {
    releases({});

    expect(screen.queryByText(/Week \d+/)).toBeNull();
  });

  it("shows the unreleased block with pull request 3055 since v1.2.0 and its count", () => {
    releases({});
    const block = screen.getByRole("region", { name: "Unreleased" });

    expect({
      since: within(block).getByText(/since v1\.2\.0/).textContent,
      change: within(block)
        .getByRole("link", { name: /test-coverage source/ })
        .getAttribute("href"),
      count: within(block).getByText("1 change unreleased").textContent,
    }).toEqual({
      since: "Merged and closed since v1.2.0.",
      change: "https://github.com/re-cinq/lore/pull/3055",
      count: "1 change unreleased",
    });
  });

  it("disables Release now and reads Nothing merged since v1.2.0 when nothing is unreleased", () => {
    releases({ unreleased: { ...UNRELEASED, changes: [] } });

    expect(
      screen.getByRole("button", { name: "Nothing merged since v1.2.0" }),
    ).toBeDisabled();
  });

  it("shows no unreleased block and no Release now on a later page", () => {
    releases({ unreleased: null });

    expect({
      block: screen.queryByRole("region", { name: "Unreleased" }),
      button: screen.queryByRole("button", { name: /Release now/ }),
    }).toEqual({ block: null, button: null });
  });

  it("links Older releases to the cursor of the next page, keeping by=person", () => {
    releases({ next: "2026-10-08T11:00:00.000Z" }, "person");

    expect(
      screen.getByRole("link", { name: "Older releases" }).getAttribute("href"),
    ).toBe(
      "/repos/re-cinq/lore/changelog?before=2026-10-08T11%3A00%3A00.000Z&by=person",
    );
  });
});

describe("ChangelogView weeks with a Release now", () => {
  const week = {
    weekKey: "2026-W43",
    from: "2026-10-19T00:00:00.000Z",
    to: "2026-10-26T00:00:00.000Z",
    current: true,
    intro: null,
    changes: [PR_3055],
  };

  it("offers Release now apart from the weeks, saying releases replace the weeks from the first release on", () => {
    render(
      <ChangelogView
        base="/repos/re-cinq/lore/changelog"
        page={{ weeks: [week], next: null }}
        grouping="list"
        writeIntro={() => Promise.resolve("")}
        releaseNow={releaseNow}
      />,
    );

    expect({
      button: screen.getByRole("button", { name: "Release now" }),
      sentence: screen.getByText(/lists releases/).textContent,
    }).toMatchObject({
      button: { disabled: false },
      sentence:
        "From the first release on, this page lists releases instead of weeks.",
    });
  });
});
