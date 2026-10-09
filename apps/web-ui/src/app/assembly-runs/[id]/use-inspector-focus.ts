// What the center column is focused on (run-viz FR4.1f): which attempt of the selected node, and whether its transcript or its pod logs are up. The pick is keyed by node, so changing nodes needs no reset.
import { useCallback, useMemo, useState } from "react";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import {
  effectiveAttempt,
  type AttemptPick,
  type InspectorKind,
} from "@/lib/run-attempt-select";

export interface InspectorFocus {
  kind: InspectorKind;
  setKind: (kind: InspectorKind) => void;
  /** The attempt on show: the viewer's pick while the node still has it, else the newest. */
  attempt: AssemblyRunNode | null;
  pickAttempt: (iteration: number) => void;
}

export function useInspectorFocus(
  selectedNodeId: string | null,
  rows: readonly AssemblyRunNode[],
): InspectorFocus {
  const [kind, setKind] = useState<InspectorKind>("transcript");

  return { kind, setKind, ...useAttemptPick(selectedNodeId, rows) };
}

function useAttemptPick(
  selectedNodeId: string | null,
  rows: readonly AssemblyRunNode[],
): Pick<InspectorFocus, "attempt" | "pickAttempt"> {
  const [pick, setPick] = useState<AttemptPick | null>(null);
  const attempt = useMemo(
    () =>
      selectedNodeId === null
        ? null
        : effectiveAttempt(pick, selectedNodeId, rows),
    [pick, selectedNodeId, rows],
  );
  const pickAttempt = useCallback(
    (iteration: number) => setPick(pickOf(selectedNodeId, iteration)),
    [selectedNodeId],
  );

  return { attempt, pickAttempt };
}

function pickOf(nodeId: string | null, iteration: number): AttemptPick | null {
  return nodeId === null ? null : { nodeId, iteration };
}
