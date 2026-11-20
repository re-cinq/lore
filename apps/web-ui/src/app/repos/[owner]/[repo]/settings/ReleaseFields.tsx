"use client";
import { RELEASE_DEFAULTS, type ReleaseBlock } from "@/lib/settings-release";
import { SettingsCard } from "@/components/SettingsCard";
import MoveMirrorButton from "./MoveMirrorButton";
import ScheduleFields from "./ScheduleFields";
import type { MirrorMove } from "./mirror-move-outcome";
import styles from "./page.module.css";

export interface ReleaseFieldsProps {
  /** The saved mirror's full name; null when the repository has none. */
  publicMirror: string | null;
  release: ReleaseBlock | undefined;
  moveMirror: MirrorMove;
}

/** The public mirror and the release schedule (specs/public-mirror, specs/scheduled-releases): one card, because a release also pushes main to the mirror. Uncontrolled like the rest of the form. */
export default function ReleaseFields(props: ReleaseFieldsProps) {
  const current = { ...RELEASE_DEFAULTS, ...props.release };

  return (
    <SettingsCard
      id="set-release"
      title="Public mirror and releases"
      description="Where this repository is published, and when it is released."
      headingLevel={3}
    >
      <MirrorField {...props} />
      <ReleaseSchedule release={current} />
    </SettingsCard>
  );
}

function ReleaseSchedule({ release }: { release: Required<ReleaseBlock> }) {
  return (
    <>
      <span className={styles.hint}>
        A release covers everything merged since the last one; with a public
        mirror it also pushes main there. &quot;Release now&quot; is on the
        Changelog tab.
      </span>
      <ReleaseSwitch enabled={release.enabled} />
      <ScheduleFields
        prefix="release"
        time={release.time}
        days={release.days}
        timezone={release.timezone}
      />
    </>
  );
}

function ReleaseSwitch({ enabled }: { enabled: boolean }) {
  return (
    <label className={styles.choice}>
      <input type="checkbox" name="release_enabled" defaultChecked={enabled} />{" "}
      Release on the schedule below
    </label>
  );
}

function MirrorField(props: ReleaseFieldsProps) {
  return (
    <div className={styles.field}>
      <label htmlFor="setting-public_mirror">Public mirror</label>
      <input
        id="setting-public_mirror"
        name="public_mirror"
        defaultValue={props.publicMirror ?? ""}
        placeholder="owner/name (empty = none)"
      />
      <span className={styles.hint}>
        A published copy of this repository. Nothing runs there, and its name
        answers with this repository&apos;s knowledge.
      </span>
      {props.publicMirror && (
        <MoveMirrorButton mirror={props.publicMirror} move={props.moveMirror} />
      )}
    </div>
  );
}
