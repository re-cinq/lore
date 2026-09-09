"use client";

import styles from "./AssembledContextView.module.css";

export interface AssemblyQueryFormProps {
  query: string;
  template: string;
  templates: string[];
  loading: boolean;
  canSubmit: boolean;
  onQueryChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onSubmit: () => void;
}

/** The query textarea, the template picker and the submit — one form because they are one decision: what to assemble and how. */
export default function AssemblyQueryForm({
  canSubmit,
  ...props
}: AssemblyQueryFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        // The button is already disabled; this guards the Enter-key path, which submits regardless.
        if (canSubmit) {
          props.onSubmit();
        }
      }}
      className={styles.form}
    >
      <QueryTextarea query={props.query} onQueryChange={props.onQueryChange} />
      <FormControls {...props} canSubmit={canSubmit} />
    </form>
  );
}

type QueryTextareaProps = Pick<
  AssemblyQueryFormProps,
  "query" | "onQueryChange"
>;

function QueryTextarea({ query, onQueryChange }: QueryTextareaProps) {
  return (
    <textarea
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      placeholder="Describe the task, like a dev session would…"
      rows={2}
      className={styles.textarea}
    />
  );
}

type FormControlsProps = Omit<
  AssemblyQueryFormProps,
  "query" | "onQueryChange" | "onSubmit"
>;

/** The template picker and the submit, which travel together: the template decides WHICH assembly runs, so choosing one and running it is a single decision. */
function FormControls({ loading, canSubmit, ...field }: FormControlsProps) {
  return (
    <div className={styles.controls}>
      <label htmlFor="template" className="meta">
        Template
      </label>
      <TemplateSelect {...field} />
      <button type="submit" className="btn" disabled={!canSubmit}>
        {loading ? "Assembling…" : "Assemble"}
      </button>
    </div>
  );
}

type TemplateSelectProps = Pick<
  AssemblyQueryFormProps,
  "template" | "templates" | "onTemplateChange"
>;

function TemplateSelect({
  template,
  templates,
  onTemplateChange,
}: TemplateSelectProps) {
  return (
    <select
      id="template"
      value={template}
      onChange={(e) => onTemplateChange(e.target.value)}
      className={styles.select}
    >
      {templates.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
