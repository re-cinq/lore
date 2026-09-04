"use client";
import { useActionState, useState } from "react";
import { KNOWN_MODELS, type AgentDefinition } from "@/lib/agents-mirror";
import { type AgentFormState, type PodResources } from "@/lib/agents-form";
import styles from "./agents.module.css";
import { agentFormValues, scopeNote } from "./agent-form-values";

export type AgentFormAction = (
  prev: AgentFormState,
  fd: FormData,
) => Promise<AgentFormState>;

/** Name is immutable after creation — it is the key the three precedence layers resolve by — so an existing agent shows it disabled and carries it in a hidden field. */
function NameField({
  isNew,
  name,
}: {
  isNew: boolean;
  name: string;
}): React.ReactElement {
  if (isNew) {
    return <input name="name_input" placeholder="my-agent" required />;
  }

  return (
    <>
      <input type="hidden" name="name" value={name} />
      <input value={name} disabled />
    </>
  );
}

/** A known model or a typed-in id. The custom box only exists while `Custom…` is selected, so a stale id can never be submitted alongside a picked one. */
function ModelField({
  selection,
  onSelect,
  customModel,
}: {
  selection: string;
  onSelect: (value: string) => void;
  customModel: string;
}): React.ReactElement {
  return (
    <>
      <select
        name="model_select"
        value={selection}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">(inherit)</option>
        {KNOWN_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {selection === "__custom__" && (
        <input
          name="model_custom"
          defaultValue={customModel}
          placeholder="model id (e.g. claude-opus-4-8)"
        />
      )}
    </>
  );
}

/** One row of the requests/limits grid. Blank inherits the platform default, which is what the placeholder shows. */
function ResourceRow({
  label,
  prefix,
  values,
  placeholders,
}: {
  label: string;
  prefix: string;
  values: PodResources["requests"];
  placeholders: [string, string, string];
}): React.ReactElement {
  const fields: [string, string | undefined, string][] = [
    ["cpu", values?.cpu, placeholders[0]],
    ["memory", values?.memory, placeholders[1]],
    ["ephemeral", values?.["ephemeral-storage"], placeholders[2]],
  ];

  return (
    <>
      <span className={styles.resourceHeading}>{label}</span>
      {fields.map(([field, value, placeholder]) => (
        <input
          key={field}
          name={`res_${prefix}_${field}`}
          defaultValue={value ?? ""}
          placeholder={placeholder}
        />
      ))}
    </>
  );
}

function PodResourceFields({
  podResources,
}: {
  podResources: PodResources;
}): React.ReactElement {
  return (
    <>
      <label>Pod resources</label>
      <div className={styles.resourceGrid}>
        <span />
        <span className={styles.resourceHeading}>CPU</span>
        <span className={styles.resourceHeading}>Memory</span>
        <span className={styles.resourceHeading}>Ephemeral storage</span>
        <ResourceRow
          label="Requests"
          prefix="requests"
          values={podResources.requests}
          placeholders={["250m", "512Mi", "2Gi"]}
        />
        <ResourceRow
          label="Limits"
          prefix="limits"
          values={podResources.limits}
          placeholders={["1", "1Gi", "4Gi"]}
        />
      </div>
      <span className={styles.formNote}>
        Kubernetes quantities (e.g. <code>500m</code>, <code>4Gi</code>). Blank
        inherits the platform defaults shown as placeholders; the values are
        stored on this definition, so they survive releases.
      </span>
    </>
  );
}

/** Repo-scoped only: the API refuses an org-wide image change, because the two-key ceremony that authorizes one is repo-scoped. */
function ImageFields({
  image,
  defaultImage,
}: {
  image: string | null | undefined;
  defaultImage?: string;
}): React.ReactElement {
  return (
    <>
      <label>Execution image (security-gated)</label>
      <input
        name="image"
        defaultValue={image ?? ""}
        placeholder={image ?? defaultImage ?? "(inherit default runner image)"}
      />
      <span className={styles.formNote}>
        Inherits the default runner image
        {defaultImage ? (
          <>
            {" "}
            (<code>{defaultImage}</code>)
          </>
        ) : null}{" "}
        when blank. Changing it requires a CODEOWNERS-approved{" "}
        <code>dark-factory-approval</code> PR — reference it below.
      </span>

      <label>Approval PR (only when changing the image)</label>
      <input name="approval_pr" placeholder="re-cinq/lore#123" />
    </>
  );
}

function HiddenFields({
  repo,
  isNew,
  executionMode,
  reviewRequired,
}: {
  repo: string;
  isNew: boolean;
  executionMode: string;
  reviewRequired: string;
}): React.ReactElement {
  return (
    <>
      <input type="hidden" name="repo" value={repo} />
      <input type="hidden" name="is_new" value={isNew ? "1" : "0"} />
      <input type="hidden" name="execution_mode" value={executionMode} />
      <input type="hidden" name="review_required" value={reviewRequired} />
    </>
  );
}

function ScopeNote({
  isNew,
  orgScope,
  inherited,
}: {
  isNew: boolean;
  orgScope: boolean;
  inherited: boolean;
}): React.ReactElement | null {
  if (isNew) {
    return null;
  }

  return <p className={styles.formNote}>{scopeNote(orgScope, inherited)}</p>;
}

function FormActions({
  isNew,
  state,
}: {
  isNew: boolean;
  state: AgentFormState;
}): React.ReactElement {
  return (
    <div className={styles.formActions}>
      <button type="submit">{isNew ? "Create agent" : "Save agent"}</button>
      {state.twoKey && (
        <span className={styles.error}>image change needs an approval PR</span>
      )}
      {state.error && <span className={styles.error}>{state.error}</span>}
    </div>
  );
}

/** Agent create/edit form; org editing forks to project agent (upserts via saveAgent). */
export default function AgentForm({
  repo,
  agent,
  action,
  isNew,
  defaultImage,
  orgScope = false,
}: {
  repo: string;
  agent: AgentDefinition | null;
  action: AgentFormAction;
  isNew: boolean;
  /** Default runner image for placeholder (shows inherited, not prefilled). */
  defaultImage?: string;
  /** Org-default editing hides image+approval (API refuses org image change). */
  orgScope?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const values = agentFormValues(agent, isNew);
  const [modelSel, setModelSel] = useState(values.initialSelection);

  return (
    <form action={formAction} className="task-form">
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

      <label>Name</label>
      <NameField isNew={isNew} name={values.name} />

      <label>Model</label>
      <ModelField
        selection={modelSel}
        onSelect={setModelSel}
        customModel={values.customModel}
      />

      <label>Timeout (minutes)</label>
      <input
        name="timeout_minutes"
        type="number"
        min={1}
        max={1440}
        defaultValue={values.timeoutMinutes}
        placeholder="(inherit)"
      />

      <label>Prompt</label>
      <textarea
        name="prompt"
        rows={6}
        defaultValue={values.prompt}
        placeholder={values.promptPlaceholder}
      />

      <PodResourceFields podResources={values.podResources} />

      {!orgScope && (
        <ImageFields image={agent?.image} defaultImage={defaultImage} />
      )}

      <FormActions isNew={isNew} state={state} />
    </form>
  );
}
