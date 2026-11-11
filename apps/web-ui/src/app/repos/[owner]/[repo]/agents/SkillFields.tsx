"use client";
import { useState } from "react";
import { Alert } from "@/components/Alert";
import type { SkillCatalogue, SkillOption } from "@/lib/skill-options";
import styles from "./agents.module.css";

interface SkillFieldsProps {
  /** The names stored on the agent, in order. */
  skills: string[];
  /** Whether the stored skills source adjusts a skill's model to the agent's. */
  adjustModels: boolean;
  catalogue: SkillCatalogue;
}

/** The agent's skills as rows with a select to add more. The `skills` field is only submitted once the list changed, so a save that never touched it keeps the stored list. */
export default function SkillFields(props: SkillFieldsProps) {
  const { skills, catalogue } = props;
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
      <SkillsNote />
      <AdjustModelsField stored={props.adjustModels} />
    </>
  );
}

function SkillsNote() {
  return (
    <span className={styles.formNote}>
      Skills the agent&apos;s pod starts with, from the org catalogue on{" "}
      <code>/skills</code>.
    </span>
  );
}

/** The checkbox's `adjust_skill_models` field is only submitted once it differs from the stored value, so a save that never touched it keeps the stored skills source. */
function AdjustModelsField({ stored }: { stored: boolean }) {
  const [adjust, setAdjust] = useState(stored);

  return (
    <>
      {adjust === stored ? null : (
        <input
          type="hidden"
          name="adjust_skill_models"
          value={adjust ? "1" : "0"}
        />
      )}
      <AdjustModelsCheckbox adjust={adjust} onChange={setAdjust} />
      <AdjustModelsNote />
    </>
  );
}

interface AdjustModelsCheckboxProps {
  adjust: boolean;
  onChange: (adjust: boolean) => void;
}

function AdjustModelsCheckbox({ adjust, onChange }: AdjustModelsCheckboxProps) {
  return (
    <label>
      <input
        type="checkbox"
        checked={adjust}
        onChange={(event) => onChange(event.target.checked)}
      />{" "}
      Adjust skill models to this agent&apos;s model
    </label>
  );
}

function AdjustModelsNote() {
  return (
    <span className={styles.formNote}>
      A skill whose model belongs to another CLI than this agent&apos;s runs on
      the agent&apos;s model. Turn off only when a proxy lets this agent reach
      the skill&apos;s model.
    </span>
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
