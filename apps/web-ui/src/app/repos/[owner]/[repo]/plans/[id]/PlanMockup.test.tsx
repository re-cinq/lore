// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import PlanMockup from "./PlanMockup";

const mermaidRender = vi.hoisted(() =>
  vi.fn(async (_id: string, source: string) => {
    if (source.includes("-->>>")) {
      throw new Error("Parse error on line 1");
    }

    return { svg: `<svg viewBox="0 0 300 184"><text>${source}</text></svg>` };
  }),
);

const mermaidInitialize = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({
  default: { initialize: mermaidInitialize, render: mermaidRender },
}));

const sketch = (over: Partial<Parameters<typeof PlanMockup>[0]> = {}) => ({
  format: "html",
  markup: "<div class='sketch'><p>hi</p></div>",
  height: 140,
  kind: "ui",
  caption: "Empty Prototype section",
  ...over,
});

describe("PlanMockup", () => {
  it("draws an html sketch in a sandboxed frame without scripts", () => {
    render(
      <PlanMockup
        {...sketch({
          markup:
            "<div class='sketch'><style>.a{}</style><button onclick='evil()'>Go</button><script>document.title='x'</script></div>",
        })}
      />,
    );

    const frame = screen.getByTitle("Empty Prototype section");

    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain(
      '<div class="sketch"><style>.a{}</style><button>Go</button></div>',
    );
    expect(frame.getAttribute("srcdoc")).not.toMatch(/script|onclick/);
  });

  it("gives an html sketch of height 140 a frame 140 high", () => {
    render(<PlanMockup {...sketch()} />);

    expect(screen.getByTitle("Empty Prototype section")).toHaveAttribute(
      "height",
      "140",
    );
  });

  it("leaves an html sketch's frame empty on the server", () => {
    expect(renderToString(<PlanMockup {...sketch()} />)).not.toContain(
      "sketch",
    );
  });

  it("titles a frame with no caption Sketch", () => {
    render(<PlanMockup {...sketch({ caption: "" })} />);

    expect(screen.getByTitle("Sketch")).toBeInTheDocument();
  });

  it("strips a script from an svg sketch", () => {
    const { container } = render(
      <PlanMockup
        {...sketch({
          format: "svg",
          markup:
            "<svg onload='evil()'><script>evil()</script><text>Store</text></svg>",
        })}
      />,
    );

    expect(container.innerHTML).toContain("<svg><text>Store</text></svg>");
    expect(container.innerHTML).not.toMatch(/script|onload/);
  });

  it("says a mermaid sketch is being drawn until it renders", async () => {
    render(
      <PlanMockup {...sketch({ format: "mermaid", markup: "graph TD; A" })} />,
    );

    expect(screen.getByText("Drawing the sketch…")).toBeInTheDocument();
    await screen.findByRole("img", { name: "Empty Prototype section" });
  });

  it("draws a mermaid sketch on the page at 100% with zoom controls", async () => {
    render(
      <PlanMockup
        {...sketch({ format: "mermaid", markup: "graph TD; A-->B" })}
      />,
    );

    const diagram = await screen.findByRole("img", {
      name: "Empty Prototype section",
    });

    expect({
      text: diagram.textContent,
      frames: document.querySelectorAll("iframe").length,
      zoom: screen.getByText("100%").tagName,
      controls: ["Zoom in", "Zoom out", "Fit"].map(
        (name) => screen.getByRole("button", { name }).tagName,
      ),
    }).toEqual({
      text: "graph TD; A-->B",
      frames: 0,
      zoom: "OUTPUT",
      controls: ["BUTTON", "BUTTON", "BUTTON"],
    });
  });

  it("zooms a mermaid sketch to 125% with Zoom in", async () => {
    render(
      <PlanMockup {...sketch({ format: "mermaid", markup: "graph TD; A" })} />,
    );
    await screen.findByRole("img", { name: "Empty Prototype section" });

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(screen.getByText("125%")).toBeInTheDocument();
  });

  it("drags a mermaid sketch 40 pixels right", async () => {
    render(
      <PlanMockup {...sketch({ format: "mermaid", markup: "graph TD; A" })} />,
    );
    const diagram = await screen.findByRole("img", {
      name: "Empty Prototype section",
    });

    fireEvent.pointerDown(diagram, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(diagram, { clientX: 50, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(diagram, { pointerId: 1 });

    expect(diagram.firstElementChild).toHaveStyle({
      transform: "translate(40px, 0px) scale(1)",
    });
  });

  it("starts mermaid in strict mode with no html labels, at full width, in the page's base theme", async () => {
    render(
      <PlanMockup {...sketch({ format: "mermaid", markup: "graph TD; A" })} />,
    );
    await screen.findByRole("img", { name: "Empty Prototype section" });

    expect(mermaidInitialize).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      flowchart: { htmlLabels: false, useMaxWidth: false },
      sequence: { useMaxWidth: false },
      er: { useMaxWidth: false },
      state: { useMaxWidth: false },
      class: { useMaxWidth: false },
      theme: "base",
      themeVariables: expect.objectContaining({ darkMode: false }),
    });
  });

  it("redraws a mermaid sketch in dark colours when the page switches to dark", async () => {
    render(
      <PlanMockup {...sketch({ format: "mermaid", markup: "graph TD; A" })} />,
    );
    await screen.findByRole("img", { name: "Empty Prototype section" });

    await act(async () => {
      document.documentElement.setAttribute("data-color-scheme", "dark");
    });
    await waitFor(() =>
      expect(mermaidInitialize).toHaveBeenLastCalledWith(
        expect.objectContaining({
          themeVariables: expect.objectContaining({ darkMode: true }),
        }),
      ),
    );
    document.documentElement.removeAttribute("data-color-scheme");
  });

  it("shows the source of a mermaid sketch that does not parse", async () => {
    render(
      <PlanMockup
        {...sketch({ format: "mermaid", markup: "graph TD; A-->>>B" })}
      />,
    );

    expect(
      await screen.findByText("This sketch could not be drawn."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("graph TD; A-->>>B").closest("details"),
    ).not.toBeNull();
  });

  it("discards a mermaid render for markup that has since changed", async () => {
    let finishFirst = (_svg: { svg: string }) => {};

    mermaidRender.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)),
    );
    const { rerender } = render(
      <PlanMockup
        {...sketch({ format: "mermaid", markup: "graph TD; Old" })}
      />,
    );

    rerender(
      <PlanMockup
        {...sketch({ format: "mermaid", markup: "graph TD; New" })}
      />,
    );
    await screen.findByRole("img", { name: "Empty Prototype section" });

    await act(async () => {
      finishFirst({ svg: '<svg viewBox="0 0 1 1"><text>stale</text></svg>' });
    });

    expect(
      screen.getByRole("img", { name: "Empty Prototype section" }).textContent,
    ).toBe("graph TD; New");
  });

  it("drops mermaid output that carries a script", async () => {
    mermaidRender.mockResolvedValueOnce({
      svg: "<svg><script>x</script></svg>",
    });
    render(
      <PlanMockup {...sketch({ format: "mermaid", markup: "graph TD; A" })} />,
    );

    expect(
      await screen.findByText("This sketch could not be drawn."),
    ).toBeInTheDocument();
  });

  it("prints a text sketch as preformatted text", () => {
    render(
      <PlanMockup
        {...sketch({ format: "text", markup: "$ lore up\nready" })}
      />,
    );

    expect(screen.getByText(/\$ lore up/).tagName).toBe("PRE");
  });

  it("prints a sketch of an unknown format as text", () => {
    render(<PlanMockup {...sketch({ format: "png", markup: "<b>raw</b>" })} />);

    expect(screen.getByText("<b>raw</b>").tagName).toBe("PRE");
  });
});
