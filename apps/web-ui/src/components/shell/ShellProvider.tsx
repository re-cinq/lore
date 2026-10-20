"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CommandPalette from "@/components/command-palette/CommandPalette";
import ShortcutsDialog from "./ShortcutsDialog";
import GlossaryDialog from "./GlossaryDialog";
import { useRailMode } from "./rail-mode";
import {
  isTypingTarget,
  shortcutAction,
  type Overlay,
  type ShortcutAction,
} from "./shortcut-keys";

/** What the frame's controls share: which overlay is open, and whether the sidebar is an icon rail. */
export interface ShellApi {
  open: Overlay | null;
  show: (overlay: Overlay) => void;
  close: () => void;
  rail: boolean;
  toggleRail: () => void;
}

const noop = () => {};

// Outside the provider (a unit test of one control) every action is inert.
const ShellContext = createContext<ShellApi>({
  open: null,
  show: noop,
  close: noop,
  rail: false,
  toggleRail: noop,
});

export function useShell(): ShellApi {
  return useContext(ShellContext);
}

/** Holds the overlays and the rail for the whole app, listens for the global shortcuts, and draws whichever overlay is open. */
export default function ShellProvider(props: { children: React.ReactNode }) {
  const { children } = props;
  const [open, setOpen] = useState<Overlay | null>(null);
  const value = useShellApi(open, setOpen);

  useShortcutKeys(open, setOpen);
  useFocusReturn(open);

  return (
    <ShellContext.Provider value={value}>
      {children}
      <ShellOverlays open={open} onClose={value.close} />
    </ShellContext.Provider>
  );
}

/** The context value: the open overlay and the rail, with the setters that change them. */
function useShellApi(
  open: Overlay | null,
  setOpen: (next: Overlay | null) => void,
): ShellApi {
  const [rail, toggleRail] = useRailMode();

  return useMemo(
    () => ({
      open,
      show: setOpen,
      close: () => setOpen(null),
      rail,
      toggleRail,
    }),
    [open, setOpen, rail, toggleRail],
  );
}

function ShellOverlays({
  open,
  onClose,
}: {
  open: Overlay | null;
  onClose: () => void;
}) {
  if (open === "palette") {
    return <CommandPalette onClose={onClose} />;
  }

  if (open === "shortcuts") {
    return <ShortcutsDialog onClose={onClose} />;
  }

  return open === "glossary" ? <GlossaryDialog onClose={onClose} /> : null;
}

type SetOverlay = React.Dispatch<React.SetStateAction<Overlay | null>>;

/** One document listener for ⌘K, `/`, `?` and Escape (shortcut-keys.ts decides what each does). */
function useShortcutKeys(open: Overlay | null, setOpen: SetOverlay) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      const action = shortcutAction({ ...pickKeys(e), typing }, open);

      if (action) {
        e.preventDefault();
        setOpen((current) => applyAction(action, current));
      }
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
}

function pickKeys(e: KeyboardEvent) {
  return {
    key: e.key,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
  };
}

export function applyAction(
  action: ShortcutAction,
  current: Overlay | null,
): Overlay | null {
  if (action.type === "close") {
    return null;
  }

  if (action.type === "open") {
    return action.overlay;
  }

  return current === action.overlay ? null : action.overlay;
}

/** Closing an overlay hands focus back to whatever opened it, so a keyboard reader resumes where they were. */
function useFocusReturn(open: Overlay | null) {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      opener.current ??= document.activeElement as HTMLElement | null;

      return;
    }
    opener.current?.focus();
    opener.current = null;
  }, [open]);
}
