"use client";

import { Alert } from "@/components/Alert";
import { useState } from "react";
import type { ClusterInstallInfo } from "@/lib/api/cluster-agents";

export interface ConnectClusterPanelProps {
  install: ClusterInstallInfo;
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

/** Cluster connect panel: renders copy-paste install command with token embedded (#1572). */
export default function ConnectClusterPanel({
  install,
}: ConnectClusterPanelProps) {
  const [name, setName] = useState("my-cluster");
  const [tags, setTags] = useState("node:agent,node:validate");
  const [copied, setCopied] = useState(false);

  if (!install.available) {
    return (
      <details className="connect-cluster">
        <summary>Connect a cluster</summary>
        <Alert variant="secondary">
          Not available: {install.reason ?? "install info is not configured"}.
          Set <code>cluster_agent_registration_token</code> in{" "}
          <code>secrets.tfvars</code> and apply, then redeploy lore-api.
        </Alert>
      </details>
    );
  }

  const command = buildConnectCommand(install, name, tags);

  return (
    <details className="connect-cluster">
      <summary>Connect a cluster</summary>
      <p className="meta">
        Point <code>kubectl</code> at the target cluster, check out{" "}
        <a href={install.repo_url}>the repo</a>, and run this from its root. The
        command embeds the registration token — treat it as a credential. Also
        needed in the env: <code>GHCR_USERNAME</code>/<code>GHCR_TOKEN</code>{" "}
        and <code>CLAUDE_CODE_OAUTH_TOKEN</code> or{" "}
        <code>ANTHROPIC_API_KEY</code>.
      </p>
      <div className="connect-cluster-form">
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Tags
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </div>
      <pre>
        <code>{command}</code>
      </pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(command);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy command"}
      </button>
    </details>
  );
}
