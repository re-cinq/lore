// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReleaseFields from "./ReleaseFields";
import type { ReleaseBlock } from "@/lib/settings-release";

const noMove = () => Promise.resolve({ ok: false as const, said: "unused" });

function renderFields(
  props: { publicMirror?: string | null; release?: ReleaseBlock } = {},
) {
  return render(
    <ReleaseFields
      publicMirror={props.publicMirror ?? null}
      release={props.release}
      moveMirror={noMove}
    />,
  );
}

const checked = (container: HTMLElement, name: string): string[] =>
  Array.from(
    container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
  )
    .filter((box) => box.checked)
    .map((box) => box.value);

describe("ReleaseFields", () => {
  it("shows the stored release and the mirror acme/public", () => {
    const { container } = renderFields({
      publicMirror: "acme/public",
      release: {
        enabled: true,
        days: [1, 4],
        time: "09:30",
        timezone: "Europe/Bucharest",
      },
    });

    expect({
      mirror: container.querySelector<HTMLInputElement>(
        'input[name="public_mirror"]',
      )?.value,
      enabled: checked(container, "release_enabled"),
      days: checked(container, "release_days"),
      time: container.querySelector<HTMLInputElement>(
        'input[name="release_time"]',
      )?.value,
      timezone: container.querySelector<HTMLSelectElement>(
        'select[name="release_timezone"]',
      )?.value,
    }).toEqual({
      mirror: "acme/public",
      enabled: ["on"],
      days: ["1", "4"],
      time: "09:30",
      timezone: "Europe/Bucharest",
    });
  });

  it("shows off, Monday, 09:00 and Europe/Berlin when no release is stored", () => {
    const { container } = renderFields();

    expect({
      enabled: checked(container, "release_enabled"),
      days: checked(container, "release_days"),
      time: container.querySelector<HTMLInputElement>(
        'input[name="release_time"]',
      )?.value,
      timezone: container.querySelector<HTMLSelectElement>(
        'select[name="release_timezone"]',
      )?.value,
    }).toEqual({
      enabled: [],
      days: ["1"],
      time: "09:00",
      timezone: "Europe/Berlin",
    });
  });

  it("offers the move button only when a mirror is saved", () => {
    const { unmount } = renderFields({ publicMirror: "acme/public" });
    const withMirror = screen.queryByRole("button", {
      name: /Preview the move/,
    });

    unmount();
    renderFields();

    expect({
      withMirror: withMirror !== null,
      without: screen.queryByRole("button", { name: /Preview the move/ }),
    }).toEqual({ withMirror: true, without: null });
  });

  it("explains the mirror and where Release now lives", () => {
    renderFields();

    expect(
      screen.getByText(/"Release now" is on the Changelog tab/),
    ).toBeInTheDocument();
  });
});
