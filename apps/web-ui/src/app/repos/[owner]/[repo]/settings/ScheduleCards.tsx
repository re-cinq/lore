"use client";
import type { components } from "@/lib/api/schema";
import DigestFields from "./DigestFields";
import ReleaseFields from "./ReleaseFields";
import type { MirrorMove } from "./mirror-move-outcome";

interface ScheduleCardsProps {
  settings: NonNullable<components["schemas"]["Repo"]["settings"]>;
  moveMirror: MirrorMove;
}

/** The daily digest, then the public mirror and the release schedule. */
export default function ScheduleCards(props: ScheduleCardsProps) {
  const { settings, moveMirror } = props;

  return (
    <>
      <DigestFields
        digest={settings.digest ?? undefined}
        slackChannelSet={Boolean(settings.slack_channel_id)}
      />
      <ReleaseFields
        publicMirror={settings.public_mirror ?? null}
        release={settings.release ?? undefined}
        moveMirror={moveMirror}
      />
    </>
  );
}
