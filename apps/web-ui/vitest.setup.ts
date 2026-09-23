import "@testing-library/jest-dom/vitest";

// jsdom has no modal dialogs; opening one is all a component test needs of it.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal(
    this: HTMLDialogElement,
  ) {
    this.open = true;
  };
}
