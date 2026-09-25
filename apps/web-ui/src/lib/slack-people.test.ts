import { describe, it, expect } from "vitest";
import { formatSlackPeople, parseSlackPeople } from "./slack-people";

describe("parseSlackPeople", () => {
  it("reads one github-login and Slack user id pair per line", () => {
    expect(
      parseSlackPeople("gedaiu U01BOGDAN\n  loredanamoanga   U02LORE  "),
    ).toEqual({
      gedaiu: "U01BOGDAN",
      loredanamoanga: "U02LORE",
    });
  });

  it("drops blank lines and lines whose second part is not a Slack user id", () => {
    expect(
      parseSlackPeople("\ngedaiu bogdan\nmuemich\nvvondruska U03VV"),
    ).toEqual({
      vvondruska: "U03VV",
    });
  });
});

describe("formatSlackPeople", () => {
  it("shows the stored map as one pair per line", () => {
    expect(formatSlackPeople('{"gedaiu":"U01BOGDAN","muemich":"U04MM"}')).toBe(
      "gedaiu U01BOGDAN\nmuemich U04MM",
    );
  });

  it("shows nothing for an unset or unreadable value", () => {
    expect([formatSlackPeople(undefined), formatSlackPeople("{nope")]).toEqual([
      "",
      "",
    ]);
  });
});
