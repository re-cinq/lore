/** DEPENDENCY-FREE like dark-factory-settings.ts: the web-ui reaches these shapes only through the generated OpenAPI types, and models/digest-settings.ts asserts at compile time that its schema infers exactly these. */

export type DigestSection = "implemented" | "roadmap" | "summary" | "morale";
export type DigestGroupBy = "person" | "area";

/** The `digest` block of `lore.repos.settings`; JSONB storage, so keys stay snake_case. */
export interface DigestSettings {
  enabled?: boolean;
  /** Local time of day, `HH:MM`. */
  time?: string;
  /** JS `getDay()` weekdays: Sunday is 0. */
  days?: number[];
  /** IANA timezone the time and days are read in. */
  timezone?: string;
  sections?: DigestSection[];
  group_by?: DigestGroupBy;
}

export interface ResolvedDigestSettings {
  enabled: boolean;
  time: string;
  days: number[];
  timezone: string;
  sections: DigestSection[];
  group_by: DigestGroupBy;
}

export const DIGEST_DEFAULTS: ResolvedDigestSettings = {
  enabled: false,
  time: "09:00",
  days: [1, 2, 3, 4, 5],
  timezone: "Europe/Berlin",
  sections: ["implemented", "roadmap", "summary", "morale"],
  group_by: "person",
};

export function resolveDigestSettings(
  block: DigestSettings | undefined,
): ResolvedDigestSettings {
  const given = Object.entries(block ?? {}).filter(
    ([, value]) => value !== undefined,
  );

  return { ...DIGEST_DEFAULTS, ...Object.fromEntries(given) };
}
