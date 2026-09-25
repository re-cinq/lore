// The daily-digest block of the settings form (specs/daily-digest FR10). Always the WHOLE block: the settings route merges shallowly, so a partial block would drop every field it leaves out.

import type { components } from "@/lib/api/schema";

export type DigestBlock = NonNullable<
  NonNullable<components["schemas"]["Repo"]["settings"]>["digest"]
>;
export type DigestSection = NonNullable<DigestBlock["sections"]>[number];
export type DigestGroupBy = NonNullable<DigestBlock["group_by"]>;

/** A copy of `DIGEST_DEFAULTS` in libs/shared/src/domain/digest-settings.ts — web-ui cannot import the library; the digest spec (FR1) is the contract that keeps them equal. */
export const DIGEST_DEFAULTS: Required<DigestBlock> = {
  enabled: false,
  time: "09:00",
  days: [1, 2, 3, 4, 5],
  timezone: "Europe/Berlin",
  sections: ["implemented", "roadmap", "summary", "morale"],
  group_by: "person",
};

export const DIGEST_SECTIONS: Array<{ value: DigestSection; label: string }> = [
  { value: "implemented", label: "Implemented (merged PRs, closed issues)" },
  { value: "roadmap", label: "Roadmap (open issues per assignee)" },
  { value: "summary", label: "Intro paragraph (written by the agent)" },
  { value: "morale", label: "Closing line (written by the agent)" },
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

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseDigestBlock(formData: FormData): Required<DigestBlock> {
  const time = String(formData.get("digest_time") ?? "").trim();
  const timezone = String(formData.get("digest_timezone") ?? "").trim();
  const groupBy = formData.get("digest_group_by");

  return {
    enabled: formData.get("digest_enabled") === "yes",
    time: TIME_OF_DAY.test(time) ? time : DIGEST_DEFAULTS.time,
    days: weekdaysOf(formData.getAll("digest_days")),
    timezone: timezone || DIGEST_DEFAULTS.timezone,
    sections: sectionsOf(formData.getAll("digest_sections")),
    group_by: groupBy === "area" ? "area" : "person",
  };
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
