import { describe, it, expect } from "vitest";
import {
  colorFor,
  toSlackMessages,
  UNASSIGNED_COLOR,
} from "./slack-sections.js";

const ALICE = "*alice*\n• did: plan fixes (#1, #2)\n• next: triage (#3)";
const BOB = "*bob*\n• did: ingest limit (#4)";

describe("toSlackMessages", () => {
  it("turns each person paragraph into an attachment and keeps the title as text", () => {
    expect(
      toSlackMessages(
        `Hello team.\n\n*Daily digest · 2026-10-27*\n\n${ALICE}\n\n${BOB}`,
      ),
    ).toEqual([
      {
        text: "Hello team.\n\n*Daily digest · 2026-10-27*",
        attachments: [
          { color: colorFor("alice"), text: ALICE },
          { color: colorFor("bob"), text: BOB },
        ],
      },
    ]);
  });

  it("posts the Full list footer and a could not read line as a reply after the people", () => {
    expect(
      toSlackMessages(
        `*Daily digest · 2026-10-27*\n\n${BOB}\n\n_could not read re-cinq/otto: 502_\n\nFull list: x`,
      ),
    ).toEqual([
      {
        text: "*Daily digest · 2026-10-27*",
        attachments: [{ color: colorFor("bob"), text: BOB }],
      },
      { text: "_could not read re-cinq/otto: 502_\n\nFull list: x" },
    ]);
  });

  it("posts a message with no person block as plain text", () => {
    expect(
      toSlackMessages("*Daily digest · 2026-10-27*\n_Nothing merged._"),
    ).toEqual([{ text: "*Daily digest · 2026-10-27*\n_Nothing merged._" }]);
  });

  it("puts 3 people into messages of at most 2 attachments", () => {
    const messages = toSlackMessages(
      `*Title*\n\n${ALICE}\n\n${BOB}\n\n*carol*\n• did: x (#5)`,
      {
        attachments: 2,
      },
    );

    expect(messages.map((message) => message.attachments?.length)).toEqual([
      2, 1,
    ]);
  });
});

describe("colorFor", () => {
  it("gives alice the same colour on every call and unassigned grey", () => {
    expect([colorFor("alice"), colorFor("unassigned")]).toEqual([
      colorFor("alice"),
      UNASSIGNED_COLOR,
    ]);
    expect(colorFor("alice")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
