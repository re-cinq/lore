// What a card outside the inspector calls to show one attempt of a node (run-viz FR4.4n). Null outside the run page's panel, where there is nothing to focus.
import { createContext, useContext } from "react";

export type FocusAttempt = (nodeId: string, iteration: number) => void;

export const RunFocusContext = createContext<FocusAttempt | null>(null);

export function useRunFocus(): FocusAttempt | null {
  return useContext(RunFocusContext);
}
