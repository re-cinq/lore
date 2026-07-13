// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SettingsView, { type SettingsApprovalConfig } from "./SettingsView";

// ThemeSwitcher is a 'use client' leaf that calls useTheme() and throws
// without a ThemeProvider. Stub it so SettingsView's own markup is the
// subject under test; the View renders it as-is in production.
vi.mock("@/components/ThemeSwitcher", () => ({
  default: () => <div data-testid="theme-switcher" />,
}));

const action = vi.fn();

const approvalConfig: SettingsApprovalConfig = {
  required: true,
  label: "approved",
  auto_approve: ["general", "gap-fill"],
  repos: { "re-cinq/production-app": { required: true } },
};

function renderView(
  over: Partial<React.ComponentProps<typeof SettingsView>> = {},
) {
  return render(
    <SettingsView
      apiUrl="https://lore-api.example.com"
      ingestToken="deadbeef"
      repoCount={7}
      totalTasks={42}
      tasksToday={3}
      approvalConfig={approvalConfig}
      repoLines={"re-cinq/production-app"}
      saveSettings={action}
      saveApprovalConfig={action}
      regenerateToken={action}
      {...over}
    />,
  );
}

describe("SettingsView", () => {
  it("renders the page heading and all section headings", () => {
    renderView();
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Appearance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Platform Configuration" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Approval Gates" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Developer Install Command",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("theme-switcher")).toBeInTheDocument();
  });

  it("renders the three stat cards with their numeric values", () => {
    renderView();
    expect(
      within(screen.getByText("Onboarded Repos").parentElement!).getByText("7"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Total Tasks").parentElement!).getByText("42"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Tasks Today").parentElement!).getByText("3"),
    ).toBeInTheDocument();
  });

  it("renders zero in the stat cards when counts are zero", () => {
    renderView({ repoCount: 0, totalTasks: 0, tasksToday: 0 });
    expect(
      within(screen.getByText("Onboarded Repos").parentElement!).getByText("0"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Total Tasks").parentElement!).getByText("0"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Tasks Today").parentElement!).getByText("0"),
    ).toBeInTheDocument();
  });

  it("wires the platform-config form fields to current api_url and ingest_token values", () => {
    const { container } = renderView();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(container.querySelector('input[name="api_url"]')).toHaveValue(
      "https://lore-api.example.com",
    );
    expect(container.querySelector('input[name="ingest_token"]')).toHaveValue(
      "deadbeef",
    );
  });

  it("uses empty defaults in the platform-config form when values are blank", () => {
    const { container } = renderView({ apiUrl: "", ingestToken: "" });
    expect(container.querySelector('input[name="api_url"]')).toHaveValue("");
    expect(container.querySelector('input[name="ingest_token"]')).toHaveValue(
      "",
    );
  });

  it("renders the regenerate-token form with its danger button and warning", () => {
    renderView();
    expect(
      screen.getByRole("button", { name: "Regenerate Token" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/invalidates all existing tokens/),
    ).toBeInTheDocument();
  });

  it("wires the approval form to the config values with the checkbox checked", () => {
    const { container } = renderView();
    expect(
      screen.getByRole("button", { name: "Save Approval Config" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('input[name="approval_required"]'),
    ).toBeChecked();
    expect(container.querySelector('input[name="approval_label"]')).toHaveValue(
      "approved",
    );
    expect(container.querySelector('input[name="auto_approve"]')).toHaveValue(
      "general, gap-fill",
    );
    expect(
      container.querySelector('textarea[name="approval_repos"]'),
    ).toHaveValue("re-cinq/production-app");
  });

  it("leaves the approval checkbox unchecked and fields empty when not required", () => {
    const { container } = renderView({
      approvalConfig: {
        required: false,
        label: "approved",
        auto_approve: [],
        repos: {},
      },
      repoLines: "",
    });
    expect(
      container.querySelector('input[name="approval_required"]'),
    ).not.toBeChecked();
    expect(container.querySelector('input[name="auto_approve"]')).toHaveValue(
      "",
    );
    expect(
      container.querySelector('textarea[name="approval_repos"]'),
    ).toHaveValue("");
  });

  it("renders the install command with the supplied token and api url", () => {
    renderView();
    const pre = screen.getByText(/git clone git@github.com:re-cinq\/lore.git/);
    expect(pre.textContent).toContain(
      "git config --global lore.ingest-token deadbeef",
    );
    expect(pre.textContent).toContain(
      "git config --global lore.api-url https://lore-api.example.com",
    );
  });

  it("renders the install command with placeholders when token and api url are blank", () => {
    renderView({ apiUrl: "", ingestToken: "" });
    const pre = screen.getByText(/git clone git@github.com:re-cinq\/lore.git/);
    expect(pre.textContent).toContain(
      "git config --global lore.ingest-token <token>",
    );
    expect(pre.textContent).toContain(
      "git config --global lore.api-url https://your-lore-api.example.com",
    );
  });
});
