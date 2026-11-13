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

const LORE_MCP = {
  name: "lore",
  transport: "http",
  url: "https://mcp.test/mcp",
  headers_secret: "lore-mcp-auth",
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

  it("orgScope notes the org-wide save, shows the image input and hides the approval input", () => {
    const { container, getByText } = render(
      <AgentForm repo="" agent={agent} action={noop} isNew={false} orgScope />,
    );

    expect(
      getByText(/Saving updates it for every repo without its own override/),
    ).toBeTruthy();
    expect({
      image: container.querySelector('input[name="image"]') !== null,
      approvalPr: container.querySelector('input[name="approval_pr"]') !== null,
    }).toEqual({ image: true, approvalPr: false });
  });

  it("prefills the lore MCP server's name, url and Authorization secret from the agent's config", () => {
    const { getByLabelText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, config: { mcp_servers: [LORE_MCP] } }}
        action={noop}
        isNew={false}
      />,
    );
    const value = (label: string) =>
      (getByLabelText(label) as HTMLInputElement).value;

    expect({
      name: value("MCP server 1 name"),
      url: value("MCP server 1 URL"),
      secret: value("MCP server 1 Authorization secret"),
    }).toEqual({
      name: "lore",
      url: "https://mcp.test/mcp",
      secret: "lore-mcp-auth",
    });
  });

  it("submits no mcp_servers field while the servers are untouched", () => {
    const { container } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, config: { mcp_servers: [LORE_MCP] } }}
        action={noop}
        isNew={false}
      />,
    );

    expect(container.querySelector('input[name="mcp_servers"]')).toBeNull();
  });

  it("submits the lore server and a new search server after Add MCP server is filled in", () => {
    const { container, getByText, getByLabelText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, config: { mcp_servers: [LORE_MCP] } }}
        action={noop}
        isNew={false}
      />,
    );

    fireEvent.click(getByText("Add MCP server"));
    fireEvent.change(getByLabelText("MCP server 2 name"), {
      target: { value: "search" },
    });
    fireEvent.change(getByLabelText("MCP server 2 URL"), {
      target: { value: "https://search.test/mcp" },
    });

    expect(
      JSON.parse(
        container.querySelector<HTMLInputElement>('input[name="mcp_servers"]')!
          .value,
      ),
    ).toEqual([
      LORE_MCP,
      { name: "search", transport: "http", url: "https://search.test/mcp" },
    ]);
  });

  it("submits an empty list after the only MCP server is removed", () => {
    const { container, getByLabelText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, config: { mcp_servers: [LORE_MCP] } }}
        action={noop}
        isNew={false}
      />,
    );

    fireEvent.click(getByLabelText("Remove MCP server 1"));

    expect(
      container.querySelector<HTMLInputElement>('input[name="mcp_servers"]')
        ?.value,
    ).toBe("[]");
  });

  it("shows the inherited skills lore-context on a repo's agent without writing them", () => {
    const { container, getByText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, config: { skills: ["lore-context"] } }}
        action={noop}
        isNew={false}
      />,
    );

    expect({
      listed: getByText("lore-context") !== null,
      written: container.querySelector('input[name="skills"]') !== null,
    }).toEqual({ listed: true, written: false });
  });

  it("submits cli-design beside lore-context after cli-design is picked from the catalogue", () => {
    const { container, getByLabelText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, config: { skills: ["lore-context"] } }}
        action={noop}
        isNew={false}
        skills={{ options: [{ name: "cli-design", title: "CLI design" }] }}
      />,
    );

    fireEvent.change(getByLabelText("Add skill"), {
      target: { value: "cli-design" },
    });

    expect(
      JSON.parse(
        container.querySelector<HTMLInputElement>('input[name="skills"]')!
          .value,
      ),
    ).toEqual(["lore-context", "cli-design"]);
  });

  it("submits an empty list after the only skill is removed on a repo's agent", () => {
    const { container, getByLabelText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, config: { skills: ["lore-context"] } }}
        action={noop}
        isNew={false}
      />,
    );

    fireEvent.click(getByLabelText("Remove skill lore-context"));

    expect(
      container.querySelector<HTMLInputElement>('input[name="skills"]')?.value,
    ).toBe("[]");
  });

  it("offers Command and Arguments instead of a URL once the transport is stdio", () => {
    const { getByText, getByLabelText, queryByLabelText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={noop}
        isNew={false}
      />,
    );

    fireEvent.click(getByText("Add MCP server"));
    fireEvent.change(getByLabelText("MCP server 1 transport"), {
      target: { value: "stdio" },
    });

    expect({
      command: queryByLabelText("MCP server 1 command") !== null,
      args: queryByLabelText("MCP server 1 arguments") !== null,
      url: queryByLabelText("MCP server 1 URL") !== null,
    }).toEqual({ command: true, args: true, url: false });
  });

  it("submits an X-API-Key header read from search-api-key after Add header is filled in", () => {
    const { container, getByText, getByLabelText } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={{ ...agent, config: { mcp_servers: [LORE_MCP] } }}
        action={noop}
        isNew={false}
      />,
    );

    fireEvent.click(getByText("Add header"));
    fireEvent.change(getByLabelText("MCP server 1 header 1 name"), {
      target: { value: "X-API-Key" },
    });
    fireEvent.change(getByLabelText("MCP server 1 header 1 secret key"), {
      target: { value: "search-api-key" },
    });

    expect(
      JSON.parse(
        container.querySelector<HTMLInputElement>('input[name="mcp_servers"]')!
          .value,
      ),
    ).toEqual([
      { ...LORE_MCP, headers: [{ name: "X-API-Key", ref: "search-api-key" }] },
    ]);
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

  it("does not prefill the prompt editor for an inherited org agent — so an unmodified save does not copy the org prompt", () => {
    const { container } = render(
      <AgentForm
        repo="re-cinq/lore"
        agent={agent}
        action={noop}
        isNew={false}
      />,
    );

    expect({
      value: container.querySelector<HTMLInputElement>('input[name="prompt"]')
        ?.value,
      placeholder: container.querySelector(".cm-placeholder")?.textContent,
    }).toEqual({ value: "", placeholder: agent.prompt });
  });
});
