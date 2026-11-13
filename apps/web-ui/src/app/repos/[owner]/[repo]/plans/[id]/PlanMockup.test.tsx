// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
    await screen.findByTitle("Empty Prototype section");
  });

  it("draws a mermaid sketch in a frame sized to the diagram", async () => {
    render(
      <PlanMockup
        {...sketch({ format: "mermaid", markup: "graph TD; A-->B" })}
      />,
    );

    const frame = await screen.findByTitle("Empty Prototype section");

    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("height", "200");
    expect(frame.getAttribute("srcdoc")).toContain("graph TD; A-->B");
  });

  it("starts mermaid in strict mode with no html labels and no error drawing", async () => {
    render(
      <PlanMockup {...sketch({ format: "mermaid", markup: "graph TD; A" })} />,
    );
    await screen.findByTitle("Empty Prototype section");

    expect(mermaidInitialize).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      flowchart: { htmlLabels: false },
    });
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
    await screen.findByTitle("Empty Prototype section");

    await act(async () => {
      finishFirst({ svg: '<svg viewBox="0 0 1 1"><text>stale</text></svg>' });
    });

    expect(
      screen.getByTitle("Empty Prototype section").getAttribute("srcdoc"),
    ).toContain("graph TD; New");
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
