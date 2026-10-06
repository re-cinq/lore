// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PlanPageState } from "@/lib/plan-page-state";
import type { PlanActions } from "./plan-actions";
import { useRefineAsk } from "./useRefineAsk";

const INTENT = {
  slot: "intent",
  title: "Intent",
  baseHash: "3f9a",
  inputs: {},
  uses: {},
};

const ENDED =
  "The planning line has ended, so no agent is waiting to refine this plan; edit the section by hand.";

const refused: PlanActions["refine"] = async () => ({ error: ENDED });

const askIgnoringRefusal = (ask: (request: typeof INTENT) => Promise<void>) =>
  act(async () => {
    await ask(INTENT).catch(() => undefined);
  });

describe("useRefineAsk", () => {
  it("keeps lore-api's reason and rejects when the Refine of the intent section is refused", async () => {
    const { result } = renderHook(() => useRefineAsk(refused, "writing"));

    await act(async () => {
      await expect(result.current.ask(INTENT)).rejects.toThrow(
        new Error(ENDED),
      );
    });

    expect(result.current.refusal).toBe(ENDED);
  });

  it("clears the reason once a later Refine of the intent section is accepted", async () => {
    const refine = vi
      .fn<PlanActions["refine"]>()
      .mockResolvedValueOnce({ error: ENDED })
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useRefineAsk(refine, "writing"));

    await askIgnoringRefusal(result.current.ask);
    const shown = result.current.refusal;

    await act(async () => {
      await result.current.ask(INTENT);
    });

    expect({ shown, after: result.current.refusal }).toEqual({
      shown: ENDED,
      after: null,
    });
  });

  it("clears the reason when the plan page moves from writing to refining", async () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: PlanPageState }) => useRefineAsk(refused, state),
      { initialProps: { state: "writing" } },
    );

    await askIgnoringRefusal(result.current.ask);
    const shown = result.current.refusal;

    rerender({ state: "refining" });

    expect({ shown, after: result.current.refusal }).toEqual({
      shown: ENDED,
      after: null,
    });
  });
});
