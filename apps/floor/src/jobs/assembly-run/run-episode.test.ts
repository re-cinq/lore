import { describe, it, expect } from "vitest";
import { lineWritesOwnEpisode } from "./run-episode.js";

const graph = (nodes: Array<{ id: string; type: string }>, exit: string) =>
  ({ nodes, edges: [], entry: nodes[0]?.id ?? "", exit }) as never;

describe("lineWritesOwnEpisode", () => {
  it("true when a retrospective node runs mid-line, as on implementation", () => {
    expect(
      lineWritesOwnEpisode(
        graph(
          [
            { id: "implement", type: "agent" },
            { id: "retrospective", type: "retrospective" },
            { id: "done", type: "retrospective" },
          ],
          "done",
        ),
      ),
    ).toBe(true);
  });

  it("false when the only retrospective is the exit marker, which never dispatches", () => {
    expect(
      lineWritesOwnEpisode(
        graph(
          [
            { id: "review", type: "agent" },
            { id: "done", type: "retrospective" },
          ],
          "done",
        ),
      ),
    ).toBe(false);
  });

  it("false for a null graph, so a run predating the column still gets its episode", () => {
    expect(lineWritesOwnEpisode(null)).toBe(false);
  });
});
