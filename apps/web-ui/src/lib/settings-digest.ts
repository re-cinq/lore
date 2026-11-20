// The daily-digest block of the settings form (specs/daily-digest FR10): every field of the card, without the on/off switch the Loops tab owns.

import type { components } from "@/lib/api/schema";
import { WEEKDAYS, parseSchedule } from "./schedule-form";

export { WEEKDAYS };

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

/** What an unset field shows. Web-ui cannot import the library, so this mirrors `DIGEST_DEFAULTS` in libs/shared/src/domain/digest-settings.ts; settings-digest.parity.test.ts fails the build when the two drift. */
export const DIGEST_DEFAULTS: Required<DigestBlock> = {
  enabled: false,
  time: "09:00",
  days: WEEKDAYS.map((day) => day.value).filter((day) => day >= 1 && day <= 5),
  timezone: "Europe/Berlin",
  sections: DIGEST_SECTIONS.map((section) => section.value),
  voice: "",
};

/** Everything on the Settings page's digest card. `enabled` is the Loops tab's switch, so the form never sends it, and lore-api merges the block key by key. */
export function parseDigestBlock(
  formData: FormData,
): Omit<Required<DigestBlock>, "enabled"> {
  return {
    ...parseSchedule(formData, "digest", DIGEST_DEFAULTS),
    sections: sectionsOf(formData.getAll("digest_sections")),
    voice: String(formData.get("digest_voice") ?? "")
      .trim()
      .slice(0, 200),
  };
}

function sectionsOf(raw: FormDataEntryValue[]): DigestSection[] {
  const known = new Set<string>(DIGEST_SECTIONS.map((s) => s.value));

  return raw
    .map(String)
    .filter((section): section is DigestSection => known.has(section));
}
