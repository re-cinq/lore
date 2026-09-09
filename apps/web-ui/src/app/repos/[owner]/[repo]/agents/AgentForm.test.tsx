// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import AgentForm from "./AgentForm";
import type { AgentDefinition } from "@/lib/agents-mirror";

const noop = vi.fn(async () => ({}));
const agent: AgentDefinition = {
  name: "general",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "base prompt",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  config: null,
  project_id: null,
};

describe("AgentForm", () => {
  it("shows an editable name input in create mode", () => {
    const { container } = render(
      <AgentForm repo="re-cinq/lore" agent={null} action={noop} isNew />,
    );
    const nameInput = container.querySelector(
      'input[name="name_input"]',
    ) as HTMLInputElement;

    expect(nameInput).not.toBeNull();
    expect(nameInput.disabled).toBe(false);
  });

  it("locks the name on edit and prefills the model", () => {
    const { container } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={noop}
        isNew={false}
      />,
    );

    expect(
      (container.querySelector('input[name="name"]') as HTMLInputElement).value,
    ).toBe("general");
    expect(
      (
        container.querySelector(
          'select[name="model_select"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe("claude-sonnet-4-6");
  });

  it("reveals the custom model input only when Custom… is chosen", () => {
    const { container } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={noop}
        isNew={false}
      />,
    );

    expect(container.querySelector('input[name="model_custom"]')).toBeNull();
    fireEvent.change(container.querySelector('select[name="model_select"]')!, {
      target: { value: "__custom__" },
    });
    expect(
      container.querySelector('input[name="model_custom"]'),
    ).not.toBeNull();
  });

  it("starts on Custom… when the model is not in the curated list", () => {
    const { container } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, model: "my-model" }}
        action={noop}
        isNew={false}
      />,
    );

    expect(
      (
        container.querySelector(
          'select[name="model_select"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe("__custom__");
    expect(
      (
        container.querySelector(
          'input[name="model_custom"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("my-model");
  });

  it("notes that values are inherited from org when editing an org agent", () => {
    const { getByText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={noop}
        isNew={false}
      />,
    );

    expect(
      getByText(/inherited from the organisation default/),
    ).toBeInTheDocument();
  });

  it("notes a project override when editing an already-overridden agent", () => {
    const { getByText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, project_id: "p1" }}
        action={noop}
        isNew={false}
      />,
    );

    expect(
      getByText(/project agent for this repo, overriding/),
    ).toBeInTheDocument();
  });

  it("shows no inherited/override note on a new agent", () => {
    const { queryByText } = render(
      <AgentForm repo="re-cinq/lore" agent={null} action={noop} isNew />,
    );

    expect(queryByText(/inherited from the organisation default/)).toBeNull();
    expect(queryByText(/overriding the organisation default/)).toBeNull();
  });

  it("prefills the pod-resource inputs from the agent's config", () => {
    const { container } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{
          ...agent,
          config: {
            pod_resources: {
              requests: { cpu: "500m", memory: "2Gi" },
              limits: { memory: "4Gi", "ephemeral-storage": "6Gi" },
            },
          },
        }}
        action={noop}
        isNew={false}
      />,
    );
    const value = (name: string) =>
      (container.querySelector(`input[name="${name}"]`) as HTMLInputElement)
        .value;

    expect(value("res_requests_cpu")).toBe("500m");
    expect(value("res_requests_memory")).toBe("2Gi");
    expect(value("res_limits_cpu")).toBe("");
    expect(value("res_limits_memory")).toBe("4Gi");
    expect(value("res_limits_ephemeral")).toBe("6Gi");
  });

  it("renders empty pod-resource inputs with the default limits as placeholders when config carries none", () => {
    const { container } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={noop}
        isNew={false}
      />,
    );
    const memoryLimit = container.querySelector(
      'input[name="res_limits_memory"]',
    ) as HTMLInputElement;

    expect(memoryLimit.value).toBe("");
    expect(memoryLimit.placeholder).toBe("1Gi");
  });

  it("orgScope notes the org-wide save and hides the image + approval inputs", () => {
    const { container, getByText } = render(
      <AgentForm repo="" agent={agent} action={noop} isNew={false} orgScope />,
    );

    expect(
      getByText(/Saving updates it for every repo without its own override/),
    ).toBeTruthy();
    expect(container.querySelector('input[name="image"]')).toBeNull();
    expect(container.querySelector('input[name="approval_pr"]')).toBeNull();
  });

  it("surfaces an error returned by the action", async () => {
    const failing = vi.fn(async () => ({ error: "boom" }));
    const { container, findByText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={failing}
        isNew={false}
      />,
    );

    fireEvent.submit(container.querySelector("form")!);
    expect(await findByText("boom")).toBeInTheDocument();
  });

  it("shows the default runner image as the image placeholder without prefilling it", () => {
    const { container } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={noop}
        isNew={false}
        defaultImage="ghcr.io/re-cinq/lore-claude-runner:latest"
      />,
    );
    const img = container.querySelector(
      'input[name="image"]',
    ) as HTMLInputElement;

    expect(img.value).toBe("");
    expect(img.placeholder).toBe("ghcr.io/re-cinq/lore-claude-runner:latest");
  });
});
