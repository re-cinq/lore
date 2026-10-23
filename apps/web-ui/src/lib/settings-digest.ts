// The daily-digest block of the settings form (specs/daily-digest FR10): every field of the card, without the on/off switch the Loops tab owns.

import type { components } from "@/lib/api/schema";

export type DigestBlock = NonNullable<
  NonNullable<components["schemas"]["Repo"]["settings"]>["digest"]
>;
export type DigestSection = NonNullable<DigestBlock["sections"]>[number];

export const DIGEST_SECTIONS: Array<{ value: DigestSection; label: string }> = [
  {
    value: "implemented",
    label: "What each person did (merged PRs, closed issues)",
  },
  {
    value: "roadmap",
    label: "What each person does next (open PRs, assigned issues)",
  },
  { value: "summary", label: "Opening line (written by the agent)" },
];

/** JS weekday numbers, Monday first as people read a week. */
export const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/** What an unset field shows. Web-ui cannot import the library, so this mirrors `DIGEST_DEFAULTS` in libs/shared/src/domain/digest-settings.ts; settings-digest.parity.test.ts fails the build when the two drift. */
export const DIGEST_DEFAULTS: Required<DigestBlock> = {
  enabled: false,
  time: "09:00",
  days: WEEKDAYS.map((day) => day.value).filter((day) => day >= 1 && day <= 5),
  timezone: "Europe/Berlin",
  sections: DIGEST_SECTIONS.map((section) => section.value),
  voice: "",
};

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Everything on the Settings page's digest card. `enabled` is the Loops tab's switch, so the form never sends it, and lore-api merges the block key by key. */
export function parseDigestBlock(
  formData: FormData,
): Omit<Required<DigestBlock>, "enabled"> {
  return {
    time: timeOf(formData),
    days: weekdaysOf(formData.getAll("digest_days")),
    timezone: textOf(formData, "digest_timezone") || DIGEST_DEFAULTS.timezone,
    sections: sectionsOf(formData.getAll("digest_sections")),
    voice: textOf(formData, "digest_voice").slice(0, 200),
  };
}

function textOf(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function timeOf(formData: FormData): string {
  const time = textOf(formData, "digest_time");

  return TIME_OF_DAY.test(time) ? time : DIGEST_DEFAULTS.time;
}

function weekdaysOf(raw: FormDataEntryValue[]): number[] {
  const known = new Set(WEEKDAYS.map((day) => day.value));

  return raw.map(Number).filter((day) => known.has(day));
}

function sectionsOf(raw: FormDataEntryValue[]): DigestSection[] {
  const known = new Set<string>(DIGEST_SECTIONS.map((s) => s.value));

  return raw
    .map(String)
    .filter((section): section is DigestSection => known.has(section));
}
