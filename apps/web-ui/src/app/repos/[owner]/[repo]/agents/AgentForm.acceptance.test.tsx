// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import AgentForm from "./AgentForm";
import type { AgentDefinition } from "@/lib/agents-mirror";

const agent: AgentDefinition & { inherited_fields?: string[] } = {
  name: "code-review",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "org prompt",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  config: null,
  project_id: "project-1",
  inherited_fields: ["prompt"],
};

describe("AgentForm (Acceptance)", () => {
  it("renders 'inherited from org' for an inherited prompt and sends it as null", async () => {
    let submittedPrompt: FormDataEntryValue | null = "not-submitted";
    const action = vi.fn(async (_prev: unknown, formData: FormData) => {
      submittedPrompt = formData.get("prompt");

      return {};
    });

    const { container, getByText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={action}
        isNew={false}
      />,
    );

    expect(
      getByText(/inherited from org/i, { selector: ".prompt-note" }),
    ).toBeInTheDocument();

    const textarea = container.querySelector(
      'textarea[name="prompt"]',
    ) as HTMLTextAreaElement;

    expect({
      value: textarea.value,
      placeholder: textarea.placeholder,
    }).toEqual({ value: "", placeholder: "org prompt" });

    fireEvent.submit(container.querySelector("form")!);

    expect({
      called: action.mock.calls.length > 0,
      prompt: submittedPrompt,
    }).toEqual({ called: true, prompt: "" });
  });
});
