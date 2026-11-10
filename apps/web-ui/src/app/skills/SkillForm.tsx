"use client";

import { useActionState } from "react";
import { KNOWN_MODELS } from "@/lib/agents-mirror";
import { SubmitButton } from "@/components/SubmitButton";
import type { SkillFormState, SkillFormValues } from "./actions";
import { HELP_BLOCK_TEMPLATE } from "./help-template";
import type { SkillDefinition } from "./skill-definition";

export type SkillFormAction = (
  prev: SkillFormState,
  formData: FormData,
) => Promise<SkillFormState>;

interface SkillFormProps {
  /** null starts a new skill. */
  skill: SkillDefinition | null;
  action: SkillFormAction;
}

const NEW_SKILL_VALUES: SkillFormValues = {
  name: "",
  title: "",
  description: "",
  model: "",
  content: HELP_BLOCK_TEMPLATE,
  enabled: true,
};

export function SkillForm({ skill, action }: SkillFormProps) {
  const [state, formAction] = useActionState(action, {});
  const initial = state.values ?? valuesOf(skill);

  return (
    <section>
      <h2>{skill ? `Edit skill: ${skill.name}` : "New skill"}</h2>
      <form action={formAction}>
        <IdentityFields isNew={!skill} initial={initial} />
        <ModelSelect initialModel={initial.model} />
        <ContentField initialContent={initial.content} />
        <EnabledCheckbox initialEnabled={initial.enabled} />
        <FormFooter isNew={!skill} error={state.error} />
      </form>
    </section>
  );
}

function valuesOf(skill: SkillDefinition | null): SkillFormValues {
  return skill ? { ...skill, model: skill.model ?? "" } : NEW_SKILL_VALUES;
}

interface IdentityFieldsProps {
  isNew: boolean;
  initial: SkillFormValues;
}

/** The name is the skill's directory and key, so it is typed once and travels hidden afterwards. */
function IdentityFields({ isNew, initial }: IdentityFieldsProps) {
  return (
    <>
      {isNew ? (
        <TextField field="name" initial={initial} required />
      ) : (
        <input type="hidden" name="name" value={initial.name} />
      )}
      <TextField field="title" initial={initial} required />
      <TextField field="description" initial={initial} />
    </>
  );
}

function ModelSelect({ initialModel }: { initialModel: string }) {
  return (
    <div>
      <label htmlFor="skill-model">Model</label>
      <select id="skill-model" name="model" defaultValue={initialModel}>
        <option value="">(Inherit)</option>
        {KNOWN_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ContentField({ initialContent }: { initialContent: string }) {
  return (
    <div>
      <label htmlFor="skill-content">Content (SKILL.md)</label>
      <textarea
        id="skill-content"
        name="content"
        defaultValue={initialContent}
        aria-describedby="skill-content-hint"
      />
      <p id="skill-content-hint">
        The Help block between the lore-help markers needs a line starting with{" "}
        <code>**Summary.**</code> and a line starting with{" "}
        <code>**Usage:**</code>.
      </p>
    </div>
  );
}

function EnabledCheckbox({ initialEnabled }: { initialEnabled: boolean }) {
  return (
    <div>
      <label htmlFor="skill-enabled">Enabled</label>
      <input
        id="skill-enabled"
        name="enabled"
        type="checkbox"
        defaultChecked={initialEnabled}
      />
    </div>
  );
}

interface FormFooterProps {
  isNew: boolean;
  error: string | undefined;
}

function FormFooter({ isNew, error }: FormFooterProps) {
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <SubmitButton>{isNew ? "Create" : "Save"}</SubmitButton>
      {!isNew && <a href="?">Cancel</a>}
    </>
  );
}

type TextFieldName = "name" | "title" | "description";

interface TextFieldProps {
  field: TextFieldName;
  initial: SkillFormValues;
  required?: boolean;
}

function TextField({ field, initial, required }: TextFieldProps) {
  const id = `skill-${field}`;

  return (
    <div>
      <label htmlFor={id}>{LABELS[field]}</label>
      <input
        id={id}
        name={field}
        type="text"
        required={required}
        defaultValue={initial[field]}
      />
    </div>
  );
}

const LABELS: Record<TextFieldName, string> = {
  name: "Name",
  title: "Title",
  description: "Description",
};
