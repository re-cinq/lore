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
  it("returns the block with the chosen days and sections and no enabled key, which the Loops tab owns", () => {
    expect(
      parseDigestBlock(
        form({
          digest_enabled: "yes",
          digest_time: "17:30",
          digest_days: ["1", "3", "5"],
          digest_timezone: "Europe/Bucharest",
          digest_sections: ["implemented", "summary"],
          digest_voice: "  Michael Scott from The Office ",
        }),
      ),
    ).toEqual({
      time: "17:30",
      days: [1, 3, 5],
      timezone: "Europe/Bucharest",
      sections: ["implemented", "summary"],
      voice: "Michael Scott from The Office",
    });
  });

  it("returns the defaults with no sections for an empty form", () => {
    expect(parseDigestBlock(form({}))).toEqual({
      time: "09:00",
      days: [],
      timezone: "Europe/Berlin",
      sections: [],
      voice: "",
    });
  });

  it("falls back to 09:00 for a malformed time and drops unknown days and sections", () => {
    expect(
      parseDigestBlock(
        form({
          digest_time: "9am",
          digest_days: ["1", "9", "x"],
          digest_sections: ["roadmap", "gossip"],
        }),
      ),
    ).toMatchObject({
      time: "09:00",
      days: [1],
      sections: ["roadmap"],
    });
  });

  it("is sent inside the settings patch without enabled, which lore-api merges key by key so the switch stays as it was", () => {
    expect(parseSettingsForm(form({ digest_enabled: "yes" })).digest).toEqual({
      time: "09:00",
      days: [],
      timezone: "Europe/Berlin",
      sections: [],
      voice: "",
    });
  });
});
