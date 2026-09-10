"use client";

import { Alert } from "@/components/Alert";
import { useState } from "react";
import type { ClusterInstallInfo } from "@/lib/api/cluster-agents";

export interface ConnectClusterPanelProps {
  install: ClusterInstallInfo;
}

/** Cluster connect panel: renders copy-paste install command with token embedded (#1572). */
export default function ConnectClusterPanel(props: ConnectClusterPanelProps) {
  const { install } = props;

  if (!install.available) {
    return <InstallUnavailable reason={install.reason} />;
  }

  return <ConnectClusterAvailable install={install} />;
}

/** The registration token is not configured, which is a deployment state rather than a failure — the panel says what to set rather than hiding. */
function InstallUnavailable({ reason }: { reason?: string | null }) {
  return (
    <details className="connect-cluster">
      <summary>Connect a cluster</summary>
      <Alert variant="secondary">
        Not available: {reason ?? "install info is not configured"}. Set{" "}
        <code>cluster_agent_registration_token</code> in{" "}
        <code>secrets.tfvars</code> and apply, then redeploy lore-api.
      </Alert>
    </details>
  );
}

function ConnectClusterAvailable({ install }: ConnectClusterPanelProps) {
  const [name, setName] = useState("my-cluster");
  const [tags, setTags] = useState("node:agent,node:validate");
  const command = buildConnectCommand(install, name, tags);

  return (
    <details className="connect-cluster">
      <summary>Connect a cluster</summary>
      <InstallNote repoUrl={install.repo_url} />
      <div className="connect-cluster-form">
        <NamedInput label="Name" value={name} onChange={setName} />
        <NamedInput label="Tags" value={tags} onChange={setTags} />
      </div>
      <pre>
        <code>{command}</code>
      </pre>
      <CopyCommandButton command={command} />
    </details>
  );
}

/** The ready-to-paste connect command for the values the operator chose. */
export function buildConnectCommand(
  install: ClusterInstallInfo,
  name: string,
  tags: string,
): string {
  return [
    `export LORE_API_URL='${install.api_url}'`,
    `export EVENT_ROUTER_URL='${install.event_router_url}'`,
    `export LORE_CLUSTER_AGENT_REGISTRATION_TOKEN='${install.registration_token}'`,
    `scripts/install-satellite.sh --name '${name}' --tags '${tags}'`,
  ].join("\n");
}

/** What to run this against, and what else the cluster needs. Says the command embeds a registration token because a reader is about to paste it somewhere — that is the moment to say it is a credential. */
function InstallNote({ repoUrl }: { repoUrl: string }) {
  return (
    <p className="meta">
      Point <code>kubectl</code> at the target cluster, check out{" "}
      <a href={repoUrl}>the repo</a>, and run this from its root. The command
      embeds the registration token — treat it as a credential. Also needed in
      the env: <code>GHCR_USERNAME</code>/<code>GHCR_TOKEN</code> and{" "}
      <code>CLAUDE_CODE_OAUTH_TOKEN</code> or <code>ANTHROPIC_API_KEY</code>.
    </p>
  );
}

/** One field of the install command. Controlled, because the command below re-renders from these values as they are typed. */
function NamedInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** `navigator.clipboard` is typed as always present but is undefined in insecure contexts and older browsers, so the call is optional and a failure simply leaves the command on screen to copy by hand. */
function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        // lib.dom types navigator.clipboard as always present; insecure contexts/older browsers leave it undefined at runtime.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        void navigator.clipboard?.writeText(command);
        setCopied(true);
      }}
    >
      {copied ? "Copied" : "Copy command"}
    </button>
  );
}
