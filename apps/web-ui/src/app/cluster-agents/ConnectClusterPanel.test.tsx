// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConnectClusterPanel, {
  buildConnectCommand,
} from "./ConnectClusterPanel";
import type { ClusterInstallInfo } from "@/lib/api/cluster-agents";

const install = (
  over: Partial<ClusterInstallInfo> = {},
): ClusterInstallInfo => ({
  available: true,
  reason: null,
  api_url: "https://lore-api.example.com",
  event_router_url: "https://lore-events.example.com",
  registration_token: "lcar_secret",
  repo_url: "https://github.com/re-cinq/lore",
  ...over,
});

describe("buildConnectCommand", () => {
  it("exports both urls and the token, then runs the installer with name and tags", () => {
    expect(buildConnectCommand(install(), "gpu-box-1", "node:agent")).toBe(
      [
        "export LORE_API_URL='https://lore-api.example.com'",
        "export EVENT_ROUTER_URL='https://lore-events.example.com'",
        "export LORE_CLUSTER_AGENT_REGISTRATION_TOKEN='lcar_secret'",
        "scripts/install-satellite.sh --name 'gpu-box-1' --tags 'node:agent'",
      ].join("\n"),
    );
  });
});

describe("ConnectClusterPanel", () => {
  it("renders the command with lcar_secret and updates it when the name changes", () => {
    render(<ConnectClusterPanel install={install()} />);

    expect(screen.getByText(/lcar_secret/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "gpu-box-1" },
    });

    expect(screen.getByText(/--name 'gpu-box-1'/)).toBeInTheDocument();
  });

  it("explains what is missing when the hand-out is unavailable", () => {
    render(
      <ConnectClusterPanel
        install={install({
          available: false,
          reason: "not configured on the lore-api deployment: LORE_API_URL",
          api_url: null,
          registration_token: null,
        })}
      />,
    );

    expect(
      screen.getByText(/not configured on the lore-api deployment/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Copy command/)).not.toBeInTheDocument();
  });
});
