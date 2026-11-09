# Definition of Done

> Invalid nonempty timezone values are passed directly into Intl.DateTimeFormat and can throw, while the linked contract broadly promises defaults for invalid environment values.

**Strategy: `direct`** — The `isBusinessHours` entry point already reads from environment variables, allowing the timezone override to be specified and tested directly.

## Done when these pass

- [x] **falls back to the default timezone instead of throwing on an invalid timezone** — an invalid `LORE_BUSINESS_HOURS_TZ` falls back to `Europe/Berlin` behavior instead of raising an `Intl` exception.
  `libs/shared/src/lib/business-hours.acceptance.test.ts`

## Facets

- [x] Wrap the `Intl.DateTimeFormat` call in `currentHourAndWeekday` to catch `RangeError`, or validate the timezone beforehand, and fallback to `Europe/Berlin`.

## Out of scope

- Validating or changing fallback behaviors for start hour, end hour, or business days.
