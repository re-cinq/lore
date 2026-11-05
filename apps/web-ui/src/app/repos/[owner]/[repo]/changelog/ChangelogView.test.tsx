// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ChangelogView, { type Grouping } from "./ChangelogView";
import type { WriteIntro } from "./WriteIntroButton";

const W43 = {
  weekKey: "2026-W43",
  from: "2026-10-19T00:00:00.000Z",
  to: "2026-10-26T00:00:00.000Z",
  current: true,
  intro: null,
  changes: [
    {
      kind: "pr" as const,
      number: 3055,
      title: "Make the old source the test-coverage source",
      url: "https://github.com/re-cinq/lore/pull/3055",
      people: ["gedaiu"],
      at: "2026-10-22T10:00:00Z",
    },
  ],
};
const W42 = {
  ...W43,
  weekKey: "2026-W42",
  from: "2026-10-12T00:00:00.000Z",
  to: "2026-10-19T00:00:00.000Z",
  current: false,
  intro: "Utopia now holds the repo's git history.",
  changes: [{ ...W43.changes[0], number: 3000, title: "Mirror commits" }],
};

function view(grouping: Grouping = "list", next: string | null = "2026-W42") {
  return render(
    <ChangelogView
      base="/repos/re-cinq/lore/changelog"
      page={{ weeks: [W43, W42], next }}
      grouping={grouping}
      writeIntro={() => Promise.resolve("")}
    />,
  );
}

const W44_NO_INTRO = { ...W42, weekKey: "2026-W44", intro: null };

function weeks(
  page: Array<typeof W42 | typeof W43>,
  writeIntro: WriteIntro = () => Promise.resolve(""),
) {
  return render(
    <ChangelogView
      base="/repos/re-cinq/lore/changelog"
      page={{ weeks: page, next: null }}
      grouping="list"
      writeIntro={writeIntro}
    />,
  );
}

describe("ChangelogView", () => {
  it("shows week 43 as this week with no introduction yet, and week 42 with its introduction", () => {
    view();
    const thisWeek = screen.getByRole("region", {
      name: "Week 43 · 19 Oct – 25 Oct",
    });
    const lastWeek = screen.getByRole("region", {
      name: "Week 42 · 12 Oct – 18 Oct",
    });

    expect({
      thisWeek:
        within(thisWeek).getByText(/written when the week ends/) !== null,
      lastWeek:
        within(lastWeek).getByText(
          "Utopia now holds the repo's git history.",
        ) !== null,
    }).toEqual({ thisWeek: true, lastWeek: true });
  });

  it("links pull request 3055 with its number and author", () => {
    view();

    expect(
      screen
        .getByRole("link", {
          name: "Make the old source the test-coverage source",
        })
        .getAttribute("href"),
    ).toBe("https://github.com/re-cinq/lore/pull/3055");
    expect(screen.getAllByText(/#3055 · gedaiu/)).toHaveLength(1);
  });

  it("puts gedaiu as a heading over the changes when grouped by person", () => {
    view("person");

    expect(
      screen.getAllByRole("heading", { level: 4, name: "gedaiu" }),
    ).toHaveLength(2);
  });

  it("links Older weeks to before=2026-W42, keeping by=person", () => {
    view("person");

    expect(
      screen.getByRole("link", { name: "Older weeks" }).getAttribute("href"),
    ).toBe("/repos/re-cinq/lore/changelog?before=2026-W42&by=person");
  });

  it("shows no Older weeks link on the last page", () => {
    view("list", null);

    expect(screen.queryByRole("link", { name: "Older weeks" })).toBe(null);
  });

  it("shows the By person switch Off, linking to by=person, on a plain list", () => {
    view("list");
    const toggle = screen.getByRole("switch", { name: "By person" });

    expect({
      checked: toggle.getAttribute("aria-checked"),
      text: toggle.textContent,
      href: toggle.getAttribute("href"),
    }).toEqual({
      checked: "false",
      text: "Off",
      href: "/repos/re-cinq/lore/changelog?by=person",
    });
  });

  it("renders week 42's introduction as markdown: Utopia bold, whole in italics, two paragraphs", () => {
    render(
      <ChangelogView
        base="/repos/re-cinq/lore/changelog"
        page={{
          weeks: [
            {
              ...W42,
              intro:
                "**Utopia** now holds the *whole* git history.\n\nThe run list filters by repository.",
            },
          ],
          next: null,
        }}
        grouping="list"
        writeIntro={() => Promise.resolve("")}
      />,
    );
    const lastWeek = screen.getByRole("region", {
      name: "Week 42 · 12 Oct – 18 Oct",
    });

    expect({
      bold: within(lastWeek).getByText("Utopia").tagName,
      italic: within(lastWeek).getByText("whole").tagName,
      paragraphs: within(lastWeek).getByText(/now holds the/).tagName,
      second: within(lastWeek).getByText("The run list filters by repository.")
        .tagName,
    }).toEqual({ bold: "STRONG", italic: "EM", paragraphs: "P", second: "P" });
  });

  it("shows the By person switch On, linking back to the plain list, when grouped", () => {
    view("person");
    const toggle = screen.getByRole("switch", { name: "By person" });

    expect({
      checked: toggle.getAttribute("aria-checked"),
      text: toggle.textContent,
      href: toggle.getAttribute("href"),
    }).toEqual({
      checked: "true",
      text: "On",
      href: "/repos/re-cinq/lore/changelog",
    });
  });

  it("offers Write the introduction on finished week 44 with changes and no introduction", () => {
    weeks([W44_NO_INTRO]);

    expect(
      screen.getByRole("button", { name: "Write the introduction" }),
    ).toBeInTheDocument();
  });

  it("offers no Write the introduction on the current week, a week with one, or an empty week", () => {
    weeks([W43, W42, { ...W44_NO_INTRO, changes: [] }]);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts 2026-W44 and shows what the start answered", async () => {
    const asked: string[] = [];

    weeks([W44_NO_INTRO], (week: string) => {
      asked.push(week);

      return Promise.resolve(
        "Writing the introduction: reload in a minute or two.",
      );
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Write the introduction" }),
    );

    expect({
      said: (await screen.findByText(/Writing the introduction/)).textContent,
      asked,
    }).toEqual({
      said: "Writing the introduction: reload in a minute or two.",
      asked: ["2026-W44"],
    });
  });
});
