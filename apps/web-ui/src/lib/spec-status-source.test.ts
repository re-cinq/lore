import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchDocStatusesFromGraph, specStatusKey } from "./spec-status-source";
import { fetchTraceSource } from "./trace-api";

vi.mock("./trace-api", () => ({ fetchTraceSource: vi.fn() }));

const fetchTraceSourceMock = vi.mocked(fetchTraceSource);

const specSource = (status: string) =>
  `# Feature\n\n| Field | Value |\n|---|---|\n| Status | ${status} |\n`;

const adrSource = (status: string) =>
  `---\nstatus: ${status}\n---\n\n# ADR-001: X\n\nLead.\n`;

beforeEach(() => {
  fetchTraceSourceMock.mockReset();
});

describe("fetchDocStatusesFromGraph", () => {
  it("fetches only spec.md entries for the spec kind", async () => {
    fetchTraceSourceMock.mockResolvedValue(specSource("Shipped"));

    const result = await fetchDocStatusesFromGraph(
      [
        { repo: "org/a", filePath: "specs/x/spec.md" },
        { repo: "org/a", filePath: "specs/x/plan.md" },
      ],
      "spec",
    );

    expect(fetchTraceSourceMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      [specStatusKey("org/a", "specs/x/spec.md")]: {
        status: "shipped",
        label: "Shipped",
      },
    });
  });

  it("fetches every entry for the adr kind and parses frontmatter", async () => {
    fetchTraceSourceMock
      .mockResolvedValueOnce(adrSource("accepted"))
      .mockResolvedValueOnce(adrSource("superseded"));

    const result = await fetchDocStatusesFromGraph(
      [
        { repo: "org/a", filePath: "adrs/ADR-001-x.md" },
        { repo: "org/a", filePath: "adrs/ADR-002-y.md" },
      ],
      "adr",
    );

    expect(fetchTraceSourceMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      [specStatusKey("org/a", "adrs/ADR-001-x.md")]: {
        status: "shipped",
        label: "Accepted",
      },
      [specStatusKey("org/a", "adrs/ADR-002-y.md")]: {
        status: "retired",
        label: "Superseded",
      },
    });
  });

  it("omits entries whose fetch fails or whose status is unparseable", async () => {
    fetchTraceSourceMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(adrSource("draft"));

    const result = await fetchDocStatusesFromGraph(
      [
        { repo: "org/a", filePath: "adrs/ADR-001-x.md" },
        { repo: "org/a", filePath: "adrs/ADR-002-y.md" },
        { repo: "org/a", filePath: "adrs/ADR-003-z.md" },
      ],
      "adr",
    );

    expect(result).toEqual({
      [specStatusKey("org/a", "adrs/ADR-003-z.md")]: {
        status: "draft",
        label: "Draft",
      },
    });
  });

  it("batches fetches ten at a time", async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      repo: "org/a",
      filePath: `adrs/ADR-${i}.md`,
    }));

    fetchTraceSourceMock.mockResolvedValue(adrSource("draft"));

    const result = await fetchDocStatusesFromGraph(entries, "adr");

    expect(fetchTraceSourceMock).toHaveBeenCalledTimes(25);
    expect(Object.keys(result)).toHaveLength(25);
    expect(fetchTraceSourceMock.mock.calls[0]).toEqual([
      "org/a",
      "adrs/ADR-0.md",
    ]);
  });
});
