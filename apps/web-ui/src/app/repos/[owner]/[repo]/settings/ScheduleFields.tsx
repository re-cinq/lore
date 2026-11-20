"use client";
import { WEEKDAYS, type Schedule } from "@/lib/schedule-form";
import styles from "./page.module.css";

export interface ScheduleFieldsProps extends Schedule {
  /** Names the controls `<prefix>_time`, `<prefix>_days` and `<prefix>_timezone`, which `parseSchedule` reads back. */
  prefix: string;
}

/** Time of day, weekdays and timezone: the controls the digest and release cards share. Uncontrolled like the rest of the form. */
export default function ScheduleFields(props: ScheduleFieldsProps) {
  const { prefix, time, days, timezone } = props;

  return (
    <>
      <TimeField prefix={prefix} time={time} />
      <WeekdayBoxes prefix={prefix} days={days} />
      <div className={styles.field}>
        <label htmlFor={`${prefix}_timezone`}>Timezone</label>
        <TimezoneSelect prefix={prefix} timezone={timezone} />
      </div>
    </>
  );
}

function TimeField({ prefix, time }: { prefix: string; time: string }) {
  return (
    <div className={styles.field}>
      <label htmlFor={`${prefix}_time`}>Time of day</label>
      <input
        id={`${prefix}_time`}
        type="time"
        name={`${prefix}_time`}
        defaultValue={time}
      />
    </div>
  );
}

function WeekdayBoxes({ prefix, days }: { prefix: string; days: number[] }) {
  return (
    <fieldset className={styles.choices}>
      <legend>Days</legend>
      {WEEKDAYS.map((day) => (
        <label key={day.value} className={styles.choice}>
          <input
            type="checkbox"
            name={`${prefix}_days`}
            value={day.value}
            defaultChecked={days.includes(day.value)}
          />{" "}
          {day.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Every zone the browser knows, with the stored one kept even when the browser does not list it (an old name still resolves server-side). */
function TimezoneSelect(props: { prefix: string; timezone: string }) {
  const { prefix, timezone } = props;
  const zones = Intl.supportedValuesOf("timeZone");
  const options = zones.includes(timezone) ? zones : [timezone, ...zones];

  return (
    <select
      id={`${prefix}_timezone`}
      name={`${prefix}_timezone`}
      defaultValue={timezone}
    >
      {options.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}
