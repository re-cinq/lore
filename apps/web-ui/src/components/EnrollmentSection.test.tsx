// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EnrollmentSection from "./EnrollmentSection";
import type { Check } from "@/lib/enrollment";

vi.mock("./Icon", () => ({ default: () => null }));

const checks: Check[] = [
  {
    id: "onboarded",
    label: "Onboarded",
    status: "pass",
    detail: "since 2026-01-01",
  },
  {
    id: "onboarding-pr",
    label: "Onboarding PR merged",
    status: "warn",
    link: { href: "https://gh/pr/1", text: "review & merge" },
  },
  {
    id: "gh:.github/workflows/lore-ingest.yml",
    label: ".github/workflows/lore-ingest.yml on GitHub",
    status: "fail",
    detail: "missing",
    action: { kind: "reonboard", text: "create a PR with this file" },
  },
];

describe("EnrollmentSection", () => {
  it("renders the reonboard button, the link, and the pass summary when a handler is provided", () => {
    const reonboardAction = vi.fn().mockResolvedValue(undefined);

    render(
      <EnrollmentSection checks={checks} reonboardAction={reonboardAction} />,
    );

    expect(
      screen.getByRole("button", { name: "create a PR with this file" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "review & merge" }),
    ).toHaveAttribute("href", "https://gh/pr/1");
    expect(screen.getByText("1/3 checks passing")).toBeInTheDocument();
  });

  it("omits the reonboard button when no handler is provided", () => {
    render(<EnrollmentSection checks={checks} />);

    expect(
      screen.queryByRole("button", { name: "create a PR with this file" }),
    ).not.toBeInTheDocument();
  });

  it("renders the setup-webhook button, copy value, and secret reveal for a webhook row", () => {
    const setupWebhookAction = vi.fn().mockResolvedValue(undefined);
    const webhookCheck: Check = {
      id: "webhook",
      label: "Webhook delivering",
      status: "warn",
      action: { kind: "setup-webhook", text: "set up" },
      copy: { value: "https://lore/api/webhook/github", label: "set this URL" },
      secret: { value: "shhh-secret", label: "and this secret" },
    };

    render(
      <EnrollmentSection
        checks={[webhookCheck]}
        setupWebhookAction={setupWebhookAction}
      />,
    );

    expect(screen.getByRole("button", { name: "set up" })).toBeInTheDocument();
    expect(
      screen.getByText("https://lore/api/webhook/github"),
    ).toBeInTheDocument();
    expect(screen.getByText("set this URL:")).toBeInTheDocument();
    expect(screen.getByText("and this secret:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
  });

  it("omits the setup-webhook button when no handler is provided", () => {
    const webhookCheck: Check = {
      id: "webhook",
      label: "Webhook delivering",
      status: "warn",
      action: { kind: "setup-webhook", text: "set up" },
    };

    render(<EnrollmentSection checks={[webhookCheck]} />);

    expect(
      screen.queryByRole("button", { name: "set up" }),
    ).not.toBeInTheDocument();
  });
});
