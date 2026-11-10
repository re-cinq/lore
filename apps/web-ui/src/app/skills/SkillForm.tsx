"use client";

import { useActionState } from "react";
import { KNOWN_MODELS } from "@/lib/agents-mirror";
import Link from "next/link";
import PromptEditor from "@/components/prompt-editor/PromptEditor";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { SkillFormState, SkillFormValues } from "./actions";
import { HELP_BLOCK_TEMPLATE } from "./help-template";
import { splitSkillContent } from "./skill-content";
import type { SkillDefinition } from "@/lib/skill-definition";

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
    <div>
      <div className="breadcrumb">
        <Link href="/skills">Skills</Link> /{" "}
        <strong>{skill ? skill.name : "New skill"}</strong>
      </div>
      <h1>{skill ? `Edit skill: ${skill.name}` : "New skill"}</h1>
      <form action={formAction} className="task-form">
        <IdentityFields isNew={!skill} initial={initial} />
        <ModelSelect initialModel={initial.model} />
        <ContentField initialContent={initial.content} />
        <EnabledSelect initialEnabled={initial.enabled} />
        <FormFooter isNew={!skill} error={state.error} />
      </form>
    </div>
  );
}

function valuesOf(skill: SkillDefinition | null): SkillFormValues {
  return skill ? { ...skill, model: skill.model ?? "" } : NEW_SKILL_VALUES;
}

interface IdentityFieldsProps {
  isNew: boolean;
  initial: SkillFormValues;
}

/** The name is the skill's directory and key, so it is typed once and read-only afterwards. */
function IdentityFields({ isNew, initial }: IdentityFieldsProps) {
  return (
    <>
      <TextField field="name" initial={initial} required readOnly={!isNew} />
      <TextField field="title" initial={initial} required />
      <DescriptionField initialDescription={initial.description} />
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

/** Name, title, description and model have their own fields; the editor holds the body and the other frontmatter keys ride along hidden. */
function ContentField({ initialContent }: { initialContent: string }) {
  const { extraFrontmatter, body } = splitSkillContent(initialContent);

  return (
    <div>
      <input type="hidden" name="extra_frontmatter" value={extraFrontmatter} />
      <span>Content (SKILL.md)</span>
      <PromptEditor name="content" defaultValue={body} verbatim />
      <p>
        Name, title, description and model are written into the file from the
        fields above.
      </p>
      <p>
        The Help block between the lore-help markers needs a line starting with{" "}
        <code>**Summary.**</code> and a line starting with{" "}
        <code>**Usage:**</code>.
      </p>
    </div>
  );
}

function EnabledSelect({ initialEnabled }: { initialEnabled: boolean }) {
  return (
    <div>
      <label htmlFor="skill-enabled">Enabled</label>
      <select
        id="skill-enabled"
        name="enabled"
        defaultValue={initialEnabled ? "yes" : "no"}
        aria-describedby="skill-enabled-hint"
      >
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
      <p id="skill-enabled-hint">
        Yes installs this skill into every developer&apos;s ~/.claude/skills
        through the Lore MCP server; No removes it there.
      </p>
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
      <FormError message={error} />
      <SubmitButton pendingLabel={isNew ? "Creating…" : "Saving…"}>
        {isNew ? "Create" : "Save"}
      </SubmitButton>
      <Link href="/skills">Cancel</Link>
    </>
  );
}

function DescriptionField({
  initialDescription,
}: {
  initialDescription: string;
}) {
  return (
    <div>
      <label htmlFor="skill-description">{LABELS.description}</label>
      <textarea
        id="skill-description"
        name="description"
        rows={3}
        defaultValue={initialDescription}
      />
    </div>
  );
}

type TextFieldName = "name" | "title";

interface TextFieldProps {
  field: TextFieldName;
  initial: SkillFormValues;
  required?: boolean;
  readOnly?: boolean;
}

const NAME_HINT =
  "Lowercase letters, digits and dashes, starting with a letter or digit.";

const NAME_PATTERN = "[a-z0-9][a-z0-9\\-]*";

function TextField({ field, initial, required, readOnly }: TextFieldProps) {
  const id = `skill-${field}`;

  return (
    <div>
      <label htmlFor={id}>{LABELS[field]}</label>
      <input
        id={id}
        name={field}
        type="text"
        required={required}
        readOnly={readOnly}
        pattern={field === "name" ? NAME_PATTERN : undefined}
        title={field === "name" ? NAME_HINT : undefined}
        placeholder={field === "name" ? "my-skill" : undefined}
        defaultValue={initial[field]}
      />
    </div>
  );
}

const LABELS = {
  name: "Name",
  title: "Title",
  description: "Description",
};
