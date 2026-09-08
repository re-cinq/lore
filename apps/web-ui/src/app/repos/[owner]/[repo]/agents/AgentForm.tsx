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

/** What this agent IS: its name and the model behind it. The name is only editable while creating — it is the key the three precedence layers resolve by. */
function IdentityFields({
  isNew,
  values,
  modelSel,
  onModelSelect,
}: {
  isNew: boolean;
  values: ReturnType<typeof agentFormValues>;
  modelSel: string;
  onModelSelect: (value: string) => void;
}) {
  return (
    <>
      <label>Name</label>
      <NameField isNew={isNew} name={values.name} />

      <label>Model</label>
      <ModelField
        selection={modelSel}
        onSelect={onModelSelect}
        customModel={values.customModel}
      />
    </>
  );
}

/** The parts of the request the reader does not fill in: the fields carried through hidden, and the note saying whether this save writes an org default or a repo override. */
function FormPreamble({
  repo,
  isNew,
  orgScope,
  values,
}: {
  repo: string;
  isNew: boolean;
  orgScope: boolean;
  values: ReturnType<typeof agentFormValues>;
}) {
  return (
    <>
      <HiddenFields
        repo={repo}
        isNew={isNew}
        executionMode={values.executionMode}
        reviewRequired={values.reviewRequired}
      />

      <ScopeNote
        isNew={isNew}
        orgScope={orgScope}
        inherited={values.inherited}
      />
    </>
  );
}

/** How this agent RUNS: its limits, its pod resources, and — repo-scoped only — the execution image. The image is omitted org-wide because the API refuses an org-wide image change: the two-key ceremony authorizing one is itself repo-scoped. */
function ExecutionFields({
  values,
  orgScope,
  image,
  defaultImage,
}: {
  values: ReturnType<typeof agentFormValues>;
  orgScope: boolean;
  image: string | null | undefined;
  defaultImage?: string;
}) {
  return (
    <>
      <RunLimitsFields
        timeoutMinutes={values.timeoutMinutes}
        prompt={values.prompt}
        promptPlaceholder={values.promptPlaceholder}
      />

      <PodResourceFields podResources={values.podResources} />

      {!orgScope && <ImageFields image={image} defaultImage={defaultImage} />}
    </>
  );
}

export default function AgentForm(props: AgentFormProps) {
  const { repo, agent, isNew, defaultImage, orgScope = false } = props;
  const [state, formAction] = useActionState(props.action, {});
  const values = agentFormValues(agent, isNew);
  const [modelSel, setModelSel] = useState(values.initialSelection);

  return (
    <form action={formAction} className="task-form">
      <FormPreamble
        repo={repo}
        isNew={isNew}
        orgScope={orgScope}
        values={values}
      />
      <IdentityFields
        isNew={isNew}
        values={values}
        modelSel={modelSel}
        onModelSelect={setModelSel}
      />
      <ExecutionFields
        values={values}
        orgScope={orgScope}
        image={agent?.image}
        defaultImage={defaultImage}
      />

      <FormActions isNew={isNew} state={state} />
    </form>
  );
}
