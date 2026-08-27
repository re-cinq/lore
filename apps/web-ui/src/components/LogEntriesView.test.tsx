// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LogEntriesView from "./LogEntriesView";
import styles from "./LogEntriesView.module.css";
import { parseAgentLog } from "@/lib/agent-log-entries";
import {
  RESULT_TERMINAL,
  SESSION_INIT,
  TOOL_RESULT_ERROR,
  TOOL_USE_BASH,
} from "@/lib/agent-log-entries.fixtures";

describe("LogEntriesView", () => {
  it("renders '· agent started' dimmed for a lifecycle entry", () => {
    render(
      <LogEntriesView entries={[{ kind: "lifecycle", status: "started" }]} />,
    );

    expect(screen.getByText("· agent started")).toHaveClass(styles.dim);
  });

  it("renders '· init started' for a lifecycle entry carrying an init phase", () => {
    render(
      <LogEntriesView
        entries={[{ kind: "lifecycle", phase: "init", status: "started" }]}
      />,
    );

    expect(screen.getByText("· init started")).toHaveClass(styles.dim);
  });

  it("renders a rate-limit entry as one line naming each window", () => {
    render(
      <LogEntriesView
        entries={[
          {
            kind: "rate-limit",
            status: "allowed_warning",
            windows: [
              { window: "seven_day", utilization: 0.94, resetsAt: null },
              { window: "five_hour", utilization: 0.07, resetsAt: null },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "rate limit: seven_day 94% · five_hour 7% (allowed_warning)",
      ),
    ).toHaveClass(styles.rateLimit);
  });

  it("renders '· agent succeeded (exit 0)' when the lifecycle entry carries an exit code", () => {
    render(
      <LogEntriesView
        entries={[{ kind: "lifecycle", status: "succeeded", exitCode: 0 }]}
      />,
    );

    expect(screen.getByText("· agent succeeded (exit 0)")).toBeInTheDocument();
  });

  it("renders the init entry as a collapsed details with the model in the summary", () => {
    render(<LogEntriesView entries={parseAgentLog(SESSION_INIT)} />);

    expect(
      screen.getByText(
        "session started — claude-sonnet-4-6 (Claude Code 2.1.212)",
      ),
    ).toBeInTheDocument();
    const details = document.querySelector("details");

    expect(details?.open).toBe(false);
    expect(details?.textContent).toMatch(/"permissionMode"/);
  });

  it("renders 'thinking… ~444 tokens' italic-dimmed for a thinking-tokens entry", () => {
    render(
      <LogEntriesView entries={[{ kind: "thinking-tokens", tokens: 444 }]} />,
    );

    expect(screen.getByText("thinking… ~444 tokens")).toHaveClass(
      styles.thinking,
    );
  });

  it("renders the tool summary '→ Bash: …' with the tool accent class", () => {
    render(<LogEntriesView entries={parseAgentLog(TOOL_USE_BASH)} />);

    expect(screen.getByText(/^→ Bash: gh pr view 871/)).toHaveClass(
      styles.tool,
    );
  });

  it("renders a short tool-result inline without a details element", () => {
    render(
      <LogEntriesView
        entries={[
          {
            kind: "tool-result",
            text: "Launching skill: review",
            isError: false,
          },
        ]}
      />,
    );

    expect(screen.getByText("← Launching skill: review")).toBeInTheDocument();
    expect(document.querySelector("details")).toBeNull();
  });

  it("renders the multiline exit-127 tool-result as expandable details with the error class", () => {
    render(<LogEntriesView entries={parseAgentLog(TOOL_RESULT_ERROR)} />);

    const details = document.querySelector("details");

    expect(details).not.toBeNull();
    expect(details).toHaveClass(styles.error);
    expect(details?.textContent).toMatch(/gh: command not found/);
  });

  it("renders '✓ finished — 3m 21s · $0.51 · 27 turns' for the sample result entry", () => {
    render(<LogEntriesView entries={parseAgentLog(RESULT_TERMINAL)} />);

    expect(
      screen.getByText("✓ finished — 3m 21s · $0.51 · 27 turns"),
    ).toBeInTheDocument();
    expect(screen.getByText(/REVIEW_RESULT:APPROVED/)).toBeInTheDocument();
  });

  it("renders '✗ failed' with the error class for an is_error result", () => {
    render(
      <LogEntriesView
        entries={[{ kind: "result", text: "station failed", isError: true }]}
      />,
    );

    expect(screen.getByText("✗ failed")).toHaveClass(styles.error);
  });

  it("renders a station-log entry as a dimmed line", () => {
    render(
      <LogEntriesView
        entries={[{ kind: "station-log", text: "detect: scanning 42 specs" }]}
      />,
    );

    expect(screen.getByText("· detect: scanning 42 specs")).toHaveClass(
      styles.dim,
    );
  });

  it("renders the user prompt as collapsed details prefixed 'user:'", () => {
    render(
      <LogEntriesView
        entries={[
          {
            kind: "user-text",
            text: "Review target: GitHub pull request `871`.",
          },
        ]}
      />,
    );

    expect(
      screen.getByText(/^user: Review target: GitHub pull request/),
    ).toBeInTheDocument();
  });

  it("renders a raw entry verbatim", () => {
    render(
      <LogEntriesView
        entries={[{ kind: "raw", text: "[runner] Reusing cached repo" }]}
      />,
    );

    expect(
      screen.getByText("[runner] Reusing cached repo"),
    ).toBeInTheDocument();
  });

  it("renders assistant text and thinking with their own classes", () => {
    render(
      <LogEntriesView
        entries={[
          { kind: "assistant-text", text: "I'll fetch the PR metadata." },
          { kind: "thinking", text: "checking the diff first" },
        ]}
      />,
    );

    expect(screen.getByText("I'll fetch the PR metadata.")).toHaveClass(
      styles.text,
    );
    expect(screen.getByText("checking the diff first")).toHaveClass(
      styles.thinking,
    );
  });
});
