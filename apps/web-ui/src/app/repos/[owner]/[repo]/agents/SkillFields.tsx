"use client";
import { useState } from "react";
import { Alert } from "@/components/Alert";
import type { SkillCatalogue, SkillOption } from "@/lib/skill-options";
import styles from "./agents.module.css";

interface SkillFieldsProps {
  /** The names stored on the agent, in order. */
  skills: string[];
  catalogue: SkillCatalogue;
}

/** The agent's skills as rows with a select to add more. The `skills` field is only submitted once the list changed, so a save that never touched it keeps the stored list. */
export default function SkillFields({ skills, catalogue }: SkillFieldsProps) {
  const [chosen, setChosen] = useState(skills);
  const list = { chosen, options: catalogue.options, onChange: setChosen };

  return (
    <>
      <label>Skills</label>
      <EditedSkillsField stored={skills} chosen={chosen} />
      {catalogue.error ? (
        <Alert>Skills could not be loaded: {catalogue.error}</Alert>
      ) : null}
      <ChosenSkills {...list} />
      <AddSkill {...list} />
      <span className={styles.formNote}>
        Skills the agent&apos;s pod starts with, from the org catalogue on{" "}
        <code>/skills</code>.
      </span>
    </>
  );
}

function EditedSkillsField(props: { stored: string[]; chosen: string[] }) {
  const edited = JSON.stringify(props.chosen);

  return edited === JSON.stringify(props.stored) ? null : (
    <input type="hidden" name="skills" value={edited} />
  );
}

interface SkillListProps {
  chosen: string[];
  options: SkillOption[];
  onChange: (chosen: string[]) => void;
}

function ChosenSkills({ chosen, options, onChange }: SkillListProps) {
  return chosen.map((name) => (
    <SkillRow
      key={name}
      name={name}
      title={options.find((option) => option.name === name)?.title}
      onRemove={() => onChange(chosen.filter((kept) => kept !== name))}
    />
  ));
}

function AddSkill({ chosen, options, onChange }: SkillListProps) {
  return (
    <select
      aria-label="Add skill"
      value=""
      onChange={(event) => onChange([...chosen, event.target.value])}
    >
      <option value="">Add skill</option>
      {options
        .filter((option) => !chosen.includes(option.name))
        .map((option) => (
          <option key={option.name} value={option.name}>
            {option.title}
          </option>
        ))}
    </select>
  );
}

interface SkillRowProps {
  name: string;
  /** Absent for a name that is not a catalogue row. */
  title: string | undefined;
  onRemove: () => void;
}

function SkillRow({ name, title, onRemove }: SkillRowProps) {
  return (
    <div className={styles.skillRow}>
      <span>{title ?? name}</span>
      {title === undefined ? (
        <span className={styles.formNote}>built into the gateway</span>
      ) : null}
      <button
        type="button"
        className="btn-secondary"
        aria-label={`Remove skill ${name}`}
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}
