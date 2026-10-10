// A JSON value laid out for a person to read (run-viz FR4.4l): an object as its keys and values, a list numbered, a text with newlines broken into its lines, anything else as code. Pure render.
import styles from "./ItemValue.module.css";

export default function JsonView({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return <JsonList members={value} />;
  }

  if (typeof value === "object" && value !== null) {
    return <JsonObject fields={value as Record<string, unknown>} />;
  }

  return typeof value === "string" ? (
    <JsonText text={value} />
  ) : (
    <code>{JSON.stringify(value)}</code>
  );
}

function JsonList({ members }: { members: unknown[] }) {
  return (
    <ol className={styles.jsonList}>
      {members.map((member, index) => (
        <li key={index}>
          <JsonView value={member} />
        </li>
      ))}
    </ol>
  );
}

function JsonObject({ fields }: { fields: Record<string, unknown> }) {
  return (
    <dl className={styles.jsonObject}>
      {Object.entries(fields).map(([key, member]) => (
        <div key={key} className={styles.jsonField}>
          <dt>{key}</dt>
          <dd>
            <JsonView value={member} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function JsonText({ text }: { text: string }) {
  return text.includes("\n") ? (
    <div className={styles.multiline}>{text}</div>
  ) : (
    <span>{text}</span>
  );
}
