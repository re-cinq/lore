import styles from "./SettingsView.module.css";
import type { SettingsViewProps } from "./SettingsView";

type SlackPeopleFormProps = Pick<
  SettingsViewProps,
  "slackPeopleLines" | "slackPeopleRejected" | "saveSlackPeople"
>;

/** Who a GitHub login is in Slack, for the daily digest's names (specs/daily-digest FR12). Most people match by their commit email on their own; a line here fills a gap or overrides a wrong match. */
export default function SlackPeopleForm({
  slackPeopleLines,
  slackPeopleRejected,
  saveSlackPeople,
}: SlackPeopleFormProps) {
  return (
    <>
      <h2 className={styles.sectionHeading}>Slack people</h2>
      <form action={saveSlackPeople} className={`task-form ${styles.form}`}>
        {slackPeopleRejected.length > 0 && (
          <RejectedLines lines={slackPeopleRejected} />
        )}
        <SlackPeopleField lines={slackPeopleLines} />
        <div className={styles.actions}>
          <button type="submit">Save Slack people</button>
        </div>
      </form>
    </>
  );
}

function SlackPeopleField({ lines }: { lines: string }) {
  return (
    <>
      <label htmlFor="slack_people">
        GitHub login and Slack user id, one pair per line
      </label>
      <textarea
        id="slack_people"
        name="slack_people"
        rows={6}
        defaultValue={lines}
        placeholder={"gedaiu U0123ABCD\nloredanamoanga U0456EFGH"}
      />
      <SlackPeopleHint />
    </>
  );
}

function SlackPeopleHint() {
  return (
    <span className="meta">
      The daily digest shows each person under their Slack name. People are
      matched by their commit email first; a line here wins over that match. A
      Slack user id is in the person&apos;s profile under &quot;Copy member
      ID&quot;.
    </span>
  );
}

/** Nothing was saved: the whole list is written at once, and these lines could not be read. */
function RejectedLines({ lines }: { lines: string[] }) {
  return (
    <div role="alert" className={styles.warn}>
      Not saved. Each line needs a GitHub login and a Slack user id (U…),
      separated by a space. Fix these lines:
      <ul>
        {lines.map((line) => (
          <li key={line}>
            <code>{line}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
