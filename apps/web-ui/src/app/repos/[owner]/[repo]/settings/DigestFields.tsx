"use client";
import {
  DIGEST_DEFAULTS,
  DIGEST_SECTIONS,
  type DigestBlock,
} from "@/lib/settings-digest";
import { SettingsCard } from "@/components/SettingsCard";
import ScheduleFields from "./ScheduleFields";
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
      <span className={styles.hint}>
        Switch the daily digest on or off on the Loops tab.
      </span>
      <ScheduleFields
        prefix="digest"
        time={current.time}
        days={current.days}
        timezone={current.timezone}
      />
      <SectionBoxes chosen={current.sections} />
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

/** Who the agent writes the opening line as; empty keeps a plain tone (FR13). */
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
