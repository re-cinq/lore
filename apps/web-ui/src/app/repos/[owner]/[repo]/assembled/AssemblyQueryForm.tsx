"use client";

import styles from "./AssembledContextView.module.css";

export interface AssemblyQueryFormProps {
  query: string;
  template: string;
  templates: string[];
  /** The store `/api/context` reads; empty lets the repo's own setting choose. */
  backend: string;
  loading: boolean;
  canSubmit: boolean;
  onQueryChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onBackendChange: (value: string) => void;
  onSubmit: () => void;
}

const BACKENDS = [
  { value: "", label: "repo default" },
  { value: "lore", label: "lore" },
  { value: "utopia", label: "utopia" },
  { value: "both", label: "both" },
  { value: "lore-v2", label: "lore-v2 (context builder)" },
];

/** The query textarea, the template and backend pickers and the submit — one form because they are one decision: what to assemble and how. */
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

/** The pickers and the submit, which travel together: template and backend decide WHICH assembly runs, so choosing them and running it is a single decision. */
function FormControls({ loading, canSubmit, ...field }: FormControlsProps) {
  return (
    <div className={styles.controls}>
      <OptionSelect
        id="template"
        label="Template"
        value={field.template}
        options={field.templates.map((t) => ({ value: t, label: t }))}
        onChange={field.onTemplateChange}
      />
      <BackendSelect {...field} />
      <SubmitButton loading={loading} canSubmit={canSubmit} />
    </div>
  );
}

function BackendSelect({
  backend,
  onBackendChange,
}: Pick<AssemblyQueryFormProps, "backend" | "onBackendChange">) {
  return (
    <OptionSelect
      id="backend"
      label="Backend"
      value={backend}
      options={BACKENDS}
      onChange={onBackendChange}
    />
  );
}

function SubmitButton({
  loading,
  canSubmit,
}: Pick<AssemblyQueryFormProps, "loading" | "canSubmit">) {
  return (
    <button type="submit" className="btn" disabled={!canSubmit}>
      {loading ? "Assembling…" : "Assemble"}
    </button>
  );
}

interface OptionSelectProps {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

type SelectProps = Omit<OptionSelectProps, "label">;

function OptionSelect({ id, label, ...select }: OptionSelectProps) {
  return (
    <>
      <label htmlFor={id} className="meta">
        {label}
      </label>
      <Select id={id} {...select} />
    </>
  );
}

function Select({ id, value, options, onChange }: SelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={styles.select}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
