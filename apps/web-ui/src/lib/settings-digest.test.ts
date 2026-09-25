import { describe, it, expect } from "vitest";
import { parseDigestBlock } from "./settings-digest";
import { parseSettingsForm } from "./settings-form";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();

  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      v.forEach((value) => fd.append(k, value));
      continue;
    }
    fd.set(k, v);
  }

  return fd;
}

describe("parseDigestBlock", () => {
  it("returns the enabled block with the chosen days and sections", () => {
    expect(
      parseDigestBlock(
        form({
          digest_enabled: "yes",
          digest_time: "17:30",
          digest_days: ["1", "3", "5"],
          digest_timezone: "Europe/Bucharest",
          digest_sections: ["implemented", "morale"],
          digest_group_by: "area",
        }),
      ),
    ).toEqual({
      enabled: true,
      time: "17:30",
      days: [1, 3, 5],
      timezone: "Europe/Bucharest",
      sections: ["implemented", "morale"],
      group_by: "area",
    });
  });

  it("returns the defaults with enabled false and no sections for an empty form", () => {
    expect(parseDigestBlock(form({}))).toEqual({
      enabled: false,
      time: "09:00",
      days: [],
      timezone: "Europe/Berlin",
      sections: [],
      group_by: "person",
    });
  });

  it("falls back to 09:00 for a malformed time and drops unknown days and sections", () => {
    expect(
      parseDigestBlock(
        form({
          digest_time: "9am",
          digest_days: ["1", "9", "x"],
          digest_sections: ["roadmap", "gossip"],
          digest_group_by: "nonsense",
        }),
      ),
    ).toMatchObject({
      time: "09:00",
      days: [1],
      sections: ["roadmap"],
      group_by: "person",
    });
  });

  it("is sent whole inside the settings patch, so the server's shallow merge keeps it consistent", () => {
    expect(parseSettingsForm(form({ digest_enabled: "yes" })).digest).toEqual({
      enabled: true,
      time: "09:00",
      days: [],
      timezone: "Europe/Berlin",
      sections: [],
      group_by: "person",
    });
  });
});
