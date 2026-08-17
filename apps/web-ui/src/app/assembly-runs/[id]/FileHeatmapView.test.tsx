// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FileHeatmapView from "./FileHeatmapView";
import type { TouchCounts } from "@/lib/file-heatmap";

const touch = (reads: number, writes: number): TouchCounts => ({
  reads,
  writes,
});

const paths = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll("[data-path]")).map(
    (el) => el.getAttribute("data-path") ?? "",
  );

describe("FileHeatmapView", () => {
  it("renders one bar per touched file, most-weighted first", () => {
    const { container } = render(
      <FileHeatmapView
        touches={{
          "src/a.ts": touch(1, 0),
          "src/b.ts": touch(2, 1),
          "src/c.ts": touch(0, 1),
        }}
        showAll={false}
        onToggleShowAll={vi.fn()}
      />,
    );

    expect(paths(container)).toEqual(["src/b.ts", "src/a.ts", "src/c.ts"]);
  });

  it("sets each bar width from its weight", () => {
    const { container } = render(
      <FileHeatmapView
        touches={{ "src/a.ts": touch(0, 4), "src/b.ts": touch(0, 2) }}
        showAll={false}
        onToggleShowAll={vi.fn()}
      />,
    );

    const fill = (path: string) =>
      container.querySelector<HTMLElement>(`[data-path="${path}"] [data-fill]`);

    expect(fill("src/a.ts")?.style.getPropertyValue("--fill-width")).toBe(
      "100%",
    );
    expect(fill("src/b.ts")?.style.getPropertyValue("--fill-width")).toBe(
      "50%",
    );
  });

  it("labels each bar with read and write counts so meaning is not hue-only", () => {
    render(
      <FileHeatmapView
        touches={{ "src/a.ts": touch(3, 1) }}
        showAll={false}
        onToggleShowAll={vi.fn()}
      />,
    );

    expect(screen.getByText("3 read")).toBeInTheDocument();
    expect(screen.getByText("1 write")).toBeInTheDocument();
  });

  it("caps at thirty bars and offers to reveal the rest", () => {
    const touches: Record<string, TouchCounts> = {};

    for (let i = 0; i < 35; i++) {
      touches[`src/file-${i}.ts`] = touch(i + 1, 0);
    }

    const onToggle = vi.fn();
    const { container } = render(
      <FileHeatmapView
        touches={touches}
        showAll={false}
        onToggleShowAll={onToggle}
      />,
    );

    expect(container.querySelectorAll("[data-path]")).toHaveLength(30);

    fireEvent.click(screen.getByText("Show 5 more"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders every bar when show all is enabled", () => {
    const touches: Record<string, TouchCounts> = {};

    for (let i = 0; i < 35; i++) {
      touches[`src/file-${i}.ts`] = touch(i + 1, 0);
    }

    const { container } = render(
      <FileHeatmapView touches={touches} showAll onToggleShowAll={vi.fn()} />,
    );

    expect(container.querySelectorAll("[data-path]")).toHaveLength(35);
    expect(screen.getByText("Show fewer")).toBeInTheDocument();
  });

  it("truncates a long path in the middle and keeps the full path as a title", () => {
    const full =
      "/workspace/packages/very/deeply/nested/module/inner/leaf/component.tsx";
    const stripped =
      "packages/very/deeply/nested/module/inner/leaf/component.tsx";

    render(
      <FileHeatmapView
        touches={{ [full]: touch(1, 0) }}
        showAll={false}
        onToggleShowAll={vi.fn()}
      />,
    );

    const label = screen.getByTitle(stripped);

    expect(label.textContent).toContain("…");
    expect(label.textContent?.length).toBeLessThan(stripped.length);
  });

  it("renders a designed empty state when there is no file activity", () => {
    render(
      <FileHeatmapView
        touches={{}}
        showAll={false}
        onToggleShowAll={vi.fn()}
      />,
    );

    expect(screen.getByText("No files touched yet.")).toBeInTheDocument();
  });
});
