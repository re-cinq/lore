"use client";
import { useActionState, useState } from "react";
import { type AgentDefinition } from "@/lib/agents-mirror";
import { type AgentFormState } from "@/lib/agents-form";
import { agentFormValues } from "./agent-form-values";
import {
  NameField,
  ModelField,
  PodResourceFields,
  ImageFields,
  HiddenFields,
  ScopeNote,
  FormActions,
  RunLimitsFields,
} from "./AgentFormFields";

export type AgentFormAction = (
  prev: AgentFormState,
  fd: FormData,
) => Promise<AgentFormState>;

/** Agent create/edit form; org editing forks to project agent (upserts via updateAgent). */
interface AgentFormProps {
  repo: string;
  agent: AgentDefinition | null;
  action: AgentFormAction;
  isNew: boolean;
  /** Default runner image for placeholder (shows inherited, not prefilled). */
  defaultImage?: string;
  /** Org-default editing hides image+approval (API refuses org image change). */
  orgScope?: boolean;
}

/** Every prefilled value the fields read, plus the scope the save writes at — one bundle, so a field group takes the request rather than a handful of loose strings. */
type AgentFormValues = ReturnType<typeof agentFormValues> & {
  repo: string;
  isNew: boolean;
  orgScope: boolean;
};

interface IdentityFieldsProps {
  values: AgentFormValues;
  model: string;
  onSelect: (value: string) => void;
}

/** What this agent IS: its name and the model behind it. The name is only editable while creating — it is the key the three precedence layers resolve by. */
function IdentityFields({ values, model, onSelect }: IdentityFieldsProps) {
  return (
    <>
      <label>Name</label>
      <NameField isNew={values.isNew} name={values.name} />

      <label>Model</label>
      <ModelField
        selection={model}
        onSelect={onSelect}
        customModel={values.customModel}
      />
    </>
  );
}

/** The parts of the request the reader does not fill in: the fields carried through hidden, and the note saying whether this save writes an org default or a repo override. */
function FormPreamble({ values }: { values: AgentFormValues }) {
  return (
    <>
      <HiddenFields
        repo={values.repo}
        isNew={values.isNew}
        executionMode={values.executionMode}
        reviewRequired={values.reviewRequired}
      />

      <ScopeNote
        isNew={values.isNew}
        orgScope={values.orgScope}
        inherited={values.inherited}
      />
    </>
  );
}

interface ExecutionFieldsProps {
  values: AgentFormValues;
  image: string | null | undefined;
  defaultImage?: string;
}

/** How this agent RUNS: its limits, its pod resources, and — repo-scoped only — the execution image. The image is omitted org-wide because the API refuses an org-wide image change: the two-key ceremony authorizing one is itself repo-scoped. */
function ExecutionFields({
  values,
  image,
  defaultImage,
}: ExecutionFieldsProps) {
  return (
    <>
      <RunLimitsFields
        timeoutMinutes={values.timeoutMinutes}
        prompt={values.prompt}
        promptPlaceholder={values.promptPlaceholder}
      />

      <PodResourceFields podResources={values.podResources} />

      {!values.orgScope && (
        <ImageFields image={image} defaultImage={defaultImage} />
      )}
    </>
  );
}

export default function AgentForm(props: AgentFormProps) {
  const { repo, agent, isNew, defaultImage, orgScope = false } = props;
  const [state, formAction] = useActionState(props.action, {});
  const formValues = agentFormValues(agent, { isNew });
  const values = { ...formValues, repo, isNew, orgScope };
  const [model, setModel] = useState(values.initialSelection);

  return (
    <form action={formAction} className="task-form">
      <FormPreamble values={values} />
      <IdentityFields values={values} model={model} onSelect={setModel} />
      <ExecutionFields
        values={values}
        image={agent?.image}
        defaultImage={defaultImage}
      />

      <FormActions isNew={isNew} state={state} />
    </form>
  );
}
