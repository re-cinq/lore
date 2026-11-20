import { describe, it, expect } from "vitest";
import { RELEASE_DEFAULTS as canonical } from "../../../../libs/shared/src/domain/release-settings";
import { RELEASE_DEFAULTS, parseReleasePatch } from "./settings-release";

function form(fields: Record<string, string | string[]>): FormData {
  const formData = new FormData();
  const entries = Object.entries(fields).flatMap(([name, value]) =>
    [value].flat().map((each) => [name, each] as const),
  );

  entries.forEach(([name, value]) => formData.append(name, value));

  return formData;
}

const mondayAndThursday = {
  release_enabled: "on",
  release_days: ["1", "4"],
  release_time: "09:30",
  release_timezone: "Europe/Bucharest",
};

describe("release defaults parity", () => {
  it("shows the same defaults the library resolves", () => {
    expect(RELEASE_DEFAULTS).toEqual(canonical);
  });
});

describe("parseReleasePatch", () => {
  it("builds enabled on Monday and Thursday at 09:30 in Europe/Bucharest", () => {
    expect(parseReleasePatch(form(mondayAndThursday), undefined)).toEqual({
      enabled: true,
      days: [1, 4],
      time: "09:30",
      timezone: "Europe/Bucharest",
    });
  });

  it("builds enabled false when the switch is unticked on a stored enabled release", () => {
    const stored = {
      enabled: true,
      days: [1, 4],
      time: "09:30",
      timezone: "Europe/Bucharest",
    };

    expect(
      parseReleasePatch(
        form({ ...mondayAndThursday, release_enabled: "" }),
        stored,
      ),
    ).toEqual({ ...stored, enabled: false });
  });

  it("answers undefined when the form equals the stored block", () => {
    expect(
      parseReleasePatch(form(mondayAndThursday), {
        enabled: true,
        days: [4, 1],
        time: "09:30",
        timezone: "Europe/Bucharest",
      }),
    ).toBe(undefined);
  });

  it("answers undefined when the form shows the defaults and nothing is stored", () => {
    expect(
      parseReleasePatch(
        form({
          release_days: "1",
          release_time: "09:00",
          release_timezone: "Europe/Berlin",
        }),
        null,
      ),
    ).toBe(undefined);
  });

  it("answers undefined when the form has no release fields", () => {
    expect(parseReleasePatch(form({}), undefined)).toBe(undefined);
  });

  it("falls back to 09:00 when the time is not HH:MM", () => {
    expect(
      parseReleasePatch(
        form({ ...mondayAndThursday, release_time: "9h" }),
        undefined,
      ),
    ).toMatchObject({ time: "09:00" });
  });
});
