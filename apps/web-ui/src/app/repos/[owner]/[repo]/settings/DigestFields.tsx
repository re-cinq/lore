"use client";
import {
  DIGEST_DEFAULTS,
  DIGEST_SECTIONS,
  WEEKDAYS,
  type DigestBlock,
} from "@/lib/settings-digest";
import { SettingsCard } from "@/components/SettingsCard";
import Switch from "@/components/Switch";
import styles from "./page.module.css";

export interface DigestFieldsProps {
  digest: DigestBlock | undefined;
  /** The digest posts to the repo's Slack channel; without one the block saves but nothing is sent. */
  slackChannelSet: boolean;
}

/** The daily Slack digest (specs/daily-digest FR10): whether, when, and what. Uncontrolled like the rest of the form; the server action reads the whole block back. */
export default function DigestFields(props: DigestFieldsProps) {
  return (
    <SettingsCard
      id="set-digest"
      title="Daily digest"
      description="A daily Slack post of what moved on this repository."
      headingLevel={3}
    >
      <DigestBody {...props} />
    </SettingsCard>
  );
}

function DigestBody({ digest, slackChannelSet }: DigestFieldsProps) {
  const current = { ...DIGEST_DEFAULTS, ...digest };

  return (
    <>
      {!slackChannelSet && <SlackChannelHint />}
      <EnableField enabled={current.enabled} />
      <ScheduleFields
        time={current.time}
        days={current.days}
        timezone={current.timezone}
      />
      <ContentFields sections={current.sections} groupBy={current.group_by} />
      <VoiceField voice={current.voice} />
    </>
  );
}

function SlackChannelHint() {
  return (
    <span className={styles.hint}>
      Set a Slack Channel ID above first: the digest is posted there.
    </span>
  );
}

function EnableField({ enabled }: { enabled: boolean }) {
  return (
    <Switch
      name="digest_enabled"
      value="yes"
      defaultChecked={enabled}
      label="Post a daily digest to the Slack channel"
    />
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
      <div className={styles.field}>
        <label htmlFor="digest_time">Time of day</label>
        <input
          id="digest_time"
          type="time"
          name="digest_time"
          defaultValue={time}
        />
      </div>
      <WeekdayBoxes days={days} />
      <div className={styles.field}>
        <label htmlFor="digest_timezone">Timezone</label>
        <TimezoneSelect timezone={timezone} />
      </div>
    </>
  );
}

function WeekdayBoxes({ days }: { days: number[] }) {
  return (
    <fieldset className={styles.choices}>
      <legend>Days</legend>
      {WEEKDAYS.map((day) => (
        <label key={day.value} className={styles.choice}>
          <input
            type="checkbox"
            name="digest_days"
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
function TimezoneSelect({ timezone }: { timezone: string }) {
  const zones = Intl.supportedValuesOf("timeZone");
  const options = zones.includes(timezone) ? zones : [timezone, ...zones];

  return (
    <select id="digest_timezone" name="digest_timezone" defaultValue={timezone}>
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
  return (
    <>
      <SectionBoxes chosen={sections ?? []} />
      <div className={styles.field}>
        <label htmlFor="digest_group_by">Group by</label>
        <select
          id="digest_group_by"
          name="digest_group_by"
          defaultValue={groupBy}
        >
          <option value="person">Person (author or assignee)</option>
          <option value="area">Area (area:* labels)</option>
        </select>
      </div>
    </>
  );
}

function SectionBoxes({ chosen }: { chosen: string[] }) {
  return (
    <fieldset className={styles.choices}>
      <legend>Sections</legend>
      {DIGEST_SECTIONS.map((section) => (
        <label key={section.value} className={styles.choice}>
          <input
            type="checkbox"
            name="digest_sections"
            value={section.value}
            defaultChecked={chosen.includes(section.value)}
          />{" "}
          {section.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Who the agent writes the intro, the ending and a one-line aside after each section as; empty keeps a plain tone and no asides (FR13). */
function VoiceField({ voice }: { voice: DigestBlock["voice"] }) {
  return (
    <div className={styles.field}>
      <label htmlFor="digest_voice">Voice (optional)</label>
      <input
        id="digest_voice"
        name="digest_voice"
        defaultValue={voice}
        maxLength={200}
        placeholder="e.g. Michael Scott from The Office"
      />
    </div>
  );
}
