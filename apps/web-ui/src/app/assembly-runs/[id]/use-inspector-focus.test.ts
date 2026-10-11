// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { useFocusAttempt, useInspectorFocus } from "./use-inspector-focus";

const row = (nodeId: string, iteration: number): AssemblyRunNode => ({
  nodeId,
  iteration,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds: 1,
});

const ROWS = [row("draft", 1), row("draft", 2), row("draft", 3)];

describe("useFocusAttempt", () => {
  it("selects draft and its attempt 2 in one step, from no node selected", () => {
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<string | null>(null);
      const focus = useInspectorFocus(
        selected,
        ROWS.filter((r) => r.nodeId === selected),
      );

      return {
        selected,
        focus,
        focusAttempt: useFocusAttempt(setSelected, focus),
      };
    });

    act(() => result.current.focusAttempt("draft", 2));

    expect({
      selected: result.current.selected,
      attempt: result.current.focus.attempt?.iteration,
    }).toEqual({ selected: "draft", attempt: 2 });
  });
});
