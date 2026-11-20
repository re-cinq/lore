/** DEPENDENCY-FREE: the web-ui reaches this shape only through the generated OpenAPI types, and models/repo-settings.ts asserts at compile time that its schema infers exactly this. */

/** The `release` block of `lore.repos.settings` (specs/scheduled-releases); JSONB storage, so keys stay snake_case. */
export interface ReleaseSettings {
  enabled?: boolean;
  /** JS `getDay()` weekdays: Sunday is 0. */
  days?: number[];
  /** Local time of day, `HH:MM`. */
  time?: string;
  /** IANA timezone the time and days are read in. */
  timezone?: string;
}

export interface ResolvedReleaseSettings {
  enabled: boolean;
  days: number[];
  time: string;
  timezone: string;
}

export const RELEASE_DEFAULTS: ResolvedReleaseSettings = {
  enabled: false,
  days: [1],
  time: "09:00",
  timezone: "Europe/Berlin",
};

export function resolveReleaseSettings(
  block: ReleaseSettings | null | undefined,
): ResolvedReleaseSettings {
  const given = Object.entries(block ?? {}).filter(
    ([, value]) => value !== undefined,
  );

  return { ...RELEASE_DEFAULTS, ...Object.fromEntries(given) };
}

export function releaseEnabled(
  settings:
    | { release?: ReleaseSettings | null; [key: string]: unknown }
    | null
    | undefined,
): boolean {
  return resolveReleaseSettings(settings?.release).enabled;
}
