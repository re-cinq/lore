"use client";
import {
  DIGEST_DEFAULTS,
  DIGEST_SECTIONS,
  WEEKDAYS,
  type DigestBlock,
} from "@/lib/settings-digest";
import styles from "./page.module.css";

export interface DigestFieldsProps {
  digest: DigestBlock | undefined;
  /** The digest posts to the repo's Slack channel; without one the block saves but nothing is sent. */
  slackChannelSet: boolean;
}

/** The daily Slack digest (specs/daily-digest FR10): whether, when, and what. Uncontrolled like the rest of the form; the server action reads the whole block back. */
export default function DigestFields({ digest, slackChannelSet }: DigestFieldsProps) {
  const current = { ...DIGEST_DEFAULTS, ...digest };

  return (
    <>
      <h3 className={styles.section}>Daily digest</h3>
      {!slackChannelSet && (
        <span className={`meta ${styles.hint}`}>
          Set a Slack Channel ID above first: the digest is posted there.
        </span>
      )}
      <EnableField enabled={current.enabled} />
      <ScheduleFields time={current.time} days={current.days} timezone={current.timezone} />
      <ContentFields sections={current.sections} groupBy={current.group_by} />
    </>
  );
}

function EnableField({ enabled }: { enabled: boolean }) {
  return (
    <label>
      <input type="checkbox" name="digest_enabled" value="yes" defaultChecked={enabled} /> Post a daily
      digest to the Slack channel
    </label>
  );
}

interface ScheduleFieldsProps {
  time: string;
  days: number[];
  timezone: string;
}

function ScheduleFields({ time, days, timezone }: ScheduleFieldsProps) {
  return (
    <>
      <label>Time of day</label>
      <input type="time" name="digest_time" defaultValue={time} />
      <label>Days</label>
      <WeekdayBoxes days={days} />
      <label>Timezone</label>
      <TimezoneSelect timezone={timezone} />
    </>
  );
}

function WeekdayBoxes({ days }: { days: number[] }) {
  return (
    <div>
      {WEEKDAYS.map((day) => (
        <label key={day.value}>
          <input type="checkbox" name="digest_days" value={day.value} defaultChecked={days.includes(day.value)} />{" "}
          {day.label}{" "}
        </label>
      ))}
    </div>
  );
}

/** Every zone the browser knows, with the stored one kept even when the browser does not list it (an old name still resolves server-side). */
function TimezoneSelect({ timezone }: { timezone: string }) {
  const zones = Intl.supportedValuesOf("timeZone");
  const options = zones.includes(timezone) ? zones : [timezone, ...zones];

  return (
    <select name="digest_timezone" defaultValue={timezone}>
      {options.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}

interface ContentFieldsProps {
  sections: DigestBlock["sections"];
  groupBy: DigestBlock["group_by"];
}

function ContentFields({ sections, groupBy }: ContentFieldsProps) {
  const chosen = sections ?? [];

  return (
    <>
      <label>Sections</label>
      <div>
        {DIGEST_SECTIONS.map((section) => (
          <label key={section.value}>
            <input type="checkbox" name="digest_sections" value={section.value} defaultChecked={chosen.includes(section.value)} />{" "}
            {section.label}
          </label>
        ))}
      </div>
      <label>Group by</label>
      <select name="digest_group_by" defaultValue={groupBy}>
        <option value="person">Person (author or assignee)</option>
        <option value="area">Area (area:* labels)</option>
      </select>
    </>
  );
}
