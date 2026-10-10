// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVisitRead, type VisitReader } from "./use-visit-read";

const rowsByVisit: Record<string, Promise<string[]>> = {
  "visit-1": Promise.resolve(["dispatch of visit-1"]),
  "visit-2": new Promise<string[]>(() => {}),
};

const reader: VisitReader<string> = async (_runId, visitId) =>
  rowsByVisit[visitId] ?? [];

describe("useVisitRead", () => {
  it("shows no rows for visit-2 while its read is in flight, not visit-1's", async () => {
    const { result, rerender } = renderHook(
      ({ visitId }) => useVisitRead(reader, "run-1", visitId, "open"),
      { initialProps: { visitId: "visit-1" } },
    );

    await waitFor(() =>
      expect(result.current).toEqual(["dispatch of visit-1"]),
    );
    rerender({ visitId: "visit-2" });

    expect(result.current).toEqual([]);
  });
});
