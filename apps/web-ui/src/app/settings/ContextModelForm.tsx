import { SubmitButton } from "@/components/SubmitButton";
import { SettingsCard } from "@/components/SettingsCard";
import styles from "./SettingsView.module.css";
import type { SettingsViewProps } from "./SettingsView";

type ContextModelFormProps = Pick<
  SettingsViewProps,
  "contextProvider" | "contextModel" | "saveContextModel"
>;

/** lore-api's `CONTEXT_PROVIDERS` and `DEFAULT_CONTEXT_MODELS` (libs/shared/src/domain/context-model.ts), which refuses any other provider on save; web-ui is not a workspace member and cannot import them. */
const CONTEXT_PROVIDERS = ["off", "vertex", "anthropic"];

export const DEFAULT_CONTEXT_MODELS: Record<string, string> = {
  vertex: "gemini-3-flash-preview",
  anthropic: "claude-haiku-4-5",
};

const PROVIDER_LABELS: Record<string, string> = {
  off: "Off",
  vertex: "Vertex (Gemini)",
  anthropic: "Anthropic (Claude)",
};

const SUGGESTED_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.7-flash",
  "claude-haiku-4-5",
];

/** The model the context builder writes with when a call names backend lore-v2 (specs/mcp-tools/assemble-context, Context builder). */
export default function ContextModelForm(props: ContextModelFormProps) {
  return (
    <SettingsCard
      id="set-context"
      title="Context builder"
      description="The model that writes the context block for lore_assemble_context calls naming backend lore-v2."
    >
      <ContextModelFields {...props} />
    </SettingsCard>
  );
}

function ContextModelFields(props: ContextModelFormProps) {
  return (
    <form
      action={props.saveContextModel}
      className={`task-form ${styles.form}`}
    >
      <ProviderField provider={props.contextProvider} />
      <ModelField model={props.contextModel} />
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Saving…">Save context builder</SubmitButton>
      </div>
    </form>
  );
}

function ProviderField({ provider }: { provider: string }) {
  return (
    <>
      <label htmlFor="context_llm_provider">Provider</label>
      <select
        id="context_llm_provider"
        name="context_llm_provider"
        defaultValue={provider || "off"}
      >
        {CONTEXT_PROVIDERS.map((value) => (
          <option key={value} value={value}>
            {PROVIDER_LABELS[value]}
          </option>
        ))}
      </select>
      <ProviderHint />
    </>
  );
}

function ProviderHint() {
  return (
    <p className={styles.fieldNote}>
      Off leaves lore-v2 calls on the template assembly over Lore&apos;s stores.
    </p>
  );
}

function ModelField({ model }: { model: string }) {
  return (
    <>
      <label htmlFor="context_llm_model">Model</label>
      <input
        id="context_llm_model"
        name="context_llm_model"
        list="context_llm_models"
        defaultValue={model}
        placeholder={DEFAULT_CONTEXT_MODELS.vertex}
        className={styles.monoInput}
      />
      <SuggestedModels />
      <p className={styles.fieldNote}>
        Left blank, Vertex writes with {DEFAULT_CONTEXT_MODELS.vertex} and
        Anthropic with {DEFAULT_CONTEXT_MODELS.anthropic}.
      </p>
    </>
  );
}

function SuggestedModels() {
  return (
    <datalist id="context_llm_models">
      {SUGGESTED_MODELS.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}
