"use client";
import { useState } from "react";
import {
  EMPTY_SERVER,
  draftOf,
  serversOf,
  type McpServer,
  type McpServerDraft,
  type McpTransport,
  type SecretRef,
} from "@/lib/mcp-servers-form";
import styles from "./agents.module.css";

const TRANSPORTS: McpTransport[] = ["http", "sse", "stdio"];
const EMPTY_SECRET: SecretRef = { name: "", ref: "" };

/** The agent's MCP servers as editable rows. The `mcp_servers` field is only submitted once a row changed, so a save that never touched them keeps the stored list. */
export default function McpServerFields(props: { servers: McpServer[] }) {
  const stored = props.servers.map(draftOf);
  const [drafts, setDrafts] = useState(stored);

  return (
    <>
      <label>MCP servers</label>
      <EditedServersField stored={stored} drafts={drafts} />
      {drafts.map((draft, index) => (
        <McpServerCard
          key={index}
          position={index + 1}
          draft={draft}
          onChange={(next) => setDrafts(replaced(drafts, index, next))}
          onRemove={() => setDrafts(without(drafts, index))}
        />
      ))}
      <McpServersFooter onAdd={() => setDrafts([...drafts, EMPTY_SERVER])} />
    </>
  );
}

function EditedServersField(props: {
  stored: McpServerDraft[];
  drafts: McpServerDraft[];
}) {
  const edited = JSON.stringify(serversOf(props.drafts));

  return edited === JSON.stringify(serversOf(props.stored)) ? null : (
    <input type="hidden" name="mcp_servers" value={edited} />
  );
}

function McpServersFooter({ onAdd }: { onAdd: () => void }) {
  return (
    <>
      <RowButton text="Add MCP server" onClick={onAdd} />
      <span className={styles.formNote}>
        Tools the agent&apos;s pod connects to. A secret is the name of a key in
        the cluster&apos;s <code>agent-secrets</code>, never the value itself.
      </span>
    </>
  );
}

interface McpServerCardProps {
  /** 1-based, as the labels count the servers. */
  position: number;
  draft: McpServerDraft;
  onChange: (draft: McpServerDraft) => void;
  onRemove: () => void;
}

function McpServerCard(props: McpServerCardProps) {
  const { position, draft, onChange, onRemove } = props;
  const label = `MCP server ${position}`;

  return (
    <fieldset className={styles.mcpServer}>
      <IdentityRow {...props} label={label} />
      {draft.transport === "stdio" ? (
        <ProcessRow label={label} draft={draft} onChange={onChange} />
      ) : (
        <AddressRow label={label} draft={draft} onChange={onChange} />
      )}
      <SecretRows label={label} draft={draft} onChange={onChange} />
      <RowButton
        text="Remove server"
        label={`Remove ${label}`}
        onClick={onRemove}
      />
    </fieldset>
  );
}

interface RowProps {
  label: string;
  draft: McpServerDraft;
  onChange: (draft: McpServerDraft) => void;
}

function IdentityRow({ label, draft, onChange }: RowProps) {
  return (
    <div className={styles.mcpRow}>
      <TextInput
        label={`${label} name`}
        placeholder="name, e.g. search"
        value={draft.name}
        onText={(name) => onChange({ ...draft, name })}
      />
      <TransportSelect
        label={`${label} transport`}
        transport={draft.transport}
        onSelect={(transport) => onChange({ ...draft, transport })}
      />
    </div>
  );
}

interface TransportSelectProps {
  label: string;
  transport: McpTransport;
  onSelect: (transport: McpTransport) => void;
}

function TransportSelect(props: TransportSelectProps) {
  const { label, transport, onSelect } = props;

  return (
    <select
      aria-label={label}
      value={transport}
      onChange={(event) => onSelect(event.target.value as McpTransport)}
    >
      {TRANSPORTS.map((offered) => (
        <option key={offered}>{offered}</option>
      ))}
    </select>
  );
}

function AddressRow({ label, draft, onChange }: RowProps) {
  return (
    <div className={styles.mcpRow}>
      <TextInput
        label={`${label} URL`}
        placeholder="https://host/mcp"
        value={draft.url}
        onText={(url) => onChange({ ...draft, url })}
      />
      <TextInput
        label={`${label} Authorization secret`}
        placeholder="secret holding the whole Authorization header (optional)"
        value={draft.headersSecret}
        onText={(headersSecret) => onChange({ ...draft, headersSecret })}
      />
    </div>
  );
}

function ProcessRow({ label, draft, onChange }: RowProps) {
  return (
    <div className={styles.mcpRow}>
      <TextInput
        label={`${label} command`}
        placeholder="command, e.g. npx"
        value={draft.command}
        onText={(command) => onChange({ ...draft, command })}
      />
      <TextInput
        label={`${label} arguments`}
        placeholder="arguments, space-separated"
        value={draft.args}
        onText={(args) => onChange({ ...draft, args })}
      />
    </div>
  );
}

/** Headers for a server reached by URL, env vars for one the pod starts. */
function SecretRows({ label, draft, onChange }: RowProps) {
  const kind = draft.transport === "stdio" ? "variable" : "header";
  const setSecrets = (secrets: SecretRef[]) => onChange({ ...draft, secrets });
  const addSecret = () => setSecrets([...draft.secrets, EMPTY_SECRET]);

  return (
    <>
      {draft.secrets.map((secret, index) => (
        <SecretRow
          key={index}
          label={`${label} ${kind} ${index + 1}`}
          secret={secret}
          onChange={(next) => setSecrets(replaced(draft.secrets, index, next))}
          onRemove={() => setSecrets(without(draft.secrets, index))}
        />
      ))}
      <RowButton text={`Add ${kind}`} onClick={addSecret} />
    </>
  );
}

interface SecretRowProps {
  label: string;
  secret: SecretRef;
  onChange: (secret: SecretRef) => void;
  onRemove: () => void;
}

function SecretRow({ label, secret, onChange, onRemove }: SecretRowProps) {
  return (
    <div className={styles.mcpSecretRow}>
      <TextInput
        label={`${label} name`}
        placeholder="name, e.g. X-API-Key"
        value={secret.name}
        onText={(name) => onChange({ ...secret, name })}
      />
      <TextInput
        label={`${label} secret key`}
        placeholder="agent-secrets key"
        value={secret.ref}
        onText={(ref) => onChange({ ...secret, ref })}
      />
      <RowButton text="Remove" label={`Remove ${label}`} onClick={onRemove} />
    </div>
  );
}

interface TextInputProps {
  label: string;
  placeholder: string;
  value: string;
  onText: (text: string) => void;
}

function TextInput({ label, placeholder, value, onText }: TextInputProps) {
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onText(event.target.value)}
    />
  );
}

interface RowButtonProps {
  text: string;
  /** What a screen reader hears when the text alone does not say which row. */
  label?: string;
  onClick: () => void;
}

/** A button that edits the rows and never submits the form. */
function RowButton({ text, label, onClick }: RowButtonProps) {
  return (
    <div>
      <button
        type="button"
        className="btn-secondary"
        aria-label={label}
        onClick={onClick}
      >
        {text}
      </button>
    </div>
  );
}

function replaced<Row>(rows: Row[], index: number, row: Row): Row[] {
  return rows.map((kept, at) => (at === index ? row : kept));
}

function without<Row>(rows: Row[], index: number): Row[] {
  return rows.filter((_kept, at) => at !== index);
}
