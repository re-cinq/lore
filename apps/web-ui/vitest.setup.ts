import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// The session cookie needs a request; a test that wants a signed-out caller overrides this mock.
vi.mock("@/lib/session-token", () => ({
  sessionToken: vi.fn(async () => "session-token"),
}));

// jsdom has no modal dialogs; opening one is all a component test needs of it.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal(
    this: HTMLDialogElement,
  ) {
    this.open = true;
  };
}
