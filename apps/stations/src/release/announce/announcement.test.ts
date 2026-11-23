import { describe, expect, it } from "vitest";
import { announcementMessages, channelOf } from "./announcement.js";

describe("the release announcement", () => {
  it("leads with the mirror name and v1.3.0 linked to its release, then the summary", () => {
    expect(
      announcementMessages({
        name: "re-cinq/lore",
        version: "v1.3.0",
        url: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
        summary: "Adds the release line.",
      }),
    ).toEqual([
      {
        text: "*re-cinq/lore* <https://github.com/re-cinq/lore/releases/tag/v1.3.0|v1.3.0>\n\nAdds the release line.",
      },
    ]);
  });

  it("leads with the plain version when there is no release url", () => {
    expect(
      announcementMessages({
        name: "re-cinq/lore-security",
        version: "v0.1.0",
        url: null,
        summary: "First.",
      }),
    ).toEqual([{ text: "*re-cinq/lore-security* v0.1.0\n\nFirst." }]);
  });

  it("returns the channel C123 from settings, and null for none, an empty string or a non-string", () => {
    expect([
      channelOf({ slack_channel_id: "C123" }),
      channelOf({}),
      channelOf(null),
      channelOf({ slack_channel_id: "" }),
      channelOf({ slack_channel_id: 7 }),
    ]).toEqual(["C123", null, null, null, null]);
  });

  it("turns the heading, bold run, link and bullets of the notes into Slack mrkdwn", () => {
    const [message] = announcementMessages({
      name: "re-cinq/lore",
      version: "v1.2.0",
      url: null,
      summary:
        "### Release\n\nA **Changelog** tab, see [the docs](https://lore.example/docs).\n\n- one\n* two",
    });

    expect(message?.text).toBe(
      "*re-cinq/lore* v1.2.0\n\n*Release*\n\nA *Changelog* tab, see <https://lore.example/docs|the docs>.\n\n• one\n• two",
    );
  });
});
