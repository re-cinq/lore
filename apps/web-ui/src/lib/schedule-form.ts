// The time, weekdays and timezone controls the digest and release cards share; a card's fields are named `<prefix>_time`, `<prefix>_days` and `<prefix>_timezone`.

export interface Schedule {
  time: string;
  days: number[];
  timezone: string;
}

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

/** The form's schedule; a time that is not HH:MM, or a blank timezone, falls back to the card's default. */
export function parseSchedule(
  formData: FormData,
  prefix: string,
  defaults: Schedule,
): Schedule {
  const time = textOf(formData, `${prefix}_time`);
  const known = new Set(WEEKDAYS.map((day) => day.value));

  return {
    time: TIME_OF_DAY.test(time) ? time : defaults.time,
    days: formData
      .getAll(`${prefix}_days`)
      .map(Number)
      .filter((day) => known.has(day)),
    timezone: textOf(formData, `${prefix}_timezone`) || defaults.timezone,
  };
}

function textOf(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
