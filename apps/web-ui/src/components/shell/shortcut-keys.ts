/** The shell's three overlays; at most one is open at a time. */
export type Overlay = "palette" | "shortcuts" | "glossary";

export type ShortcutAction =
  | { type: "toggle"; overlay: Overlay }
  | { type: "open"; overlay: Overlay }
  | { type: "close" };

/** The parts of a keydown the shell reads; `typing` is true while focus is in a field. */
export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  typing: boolean;
}

/** What a key press does to the overlays: ⌘K / Ctrl+K toggles the palette anywhere, Escape closes, and the bare `/` and `?` work only outside a field. */
export function shortcutAction(
  input: KeyInput,
  open: Overlay | null,
): ShortcutAction | null {
  if (isPaletteChord(input)) {
    return { type: "toggle", overlay: "palette" };
  }

  if (input.key === "Escape") {
    return open ? { type: "close" } : null;
  }

  return bareKeyAction(input, open);
}

function isPaletteChord({ key, metaKey, ctrlKey }: KeyInput): boolean {
  return (metaKey || ctrlKey) && key.toLowerCase() === "k";
}

function bareKeyAction(
  input: KeyInput,
  open: Overlay | null,
): ShortcutAction | null {
  const held = [input.typing, input.metaKey, input.ctrlKey, input.altKey];

  if (held.some(Boolean)) {
    return null;
  }

  if (input.key === "/" && open === null) {
    return { type: "open", overlay: "palette" };
  }

  if (input.key === "?") {
    return { type: "toggle", overlay: "shortcuts" };
  }

  return null;
}

/** True when the key lands in something a person types into, where `/` and `?` are text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}
