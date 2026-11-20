// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MoveMirrorButton from "./MoveMirrorButton";
import type { MirrorMove, MirrorMoveOutcome } from "./mirror-move-outcome";

const summary = {
  mirror: "acme/public",
  dryRun: true,
  tables: [{ table: "memories", moved: 4, keptConflict: 1 }],
  totalMoved: 4,
  nothingToMove: false,
  cancelledRuns: 0,
  variableNote: null,
  rowDeleted: false,
};

interface Request {
  confirm?: string;
  dry_run: boolean;
}

function mover(
  requests: Request[],
  answer: (request: Request) => MirrorMoveOutcome,
): MirrorMove {
  return (request) => {
    requests.push(request);

    return Promise.resolve(answer(request));
  };
}

const previewAndMove = (request: Request): MirrorMoveOutcome =>
  request.dry_run
    ? { ok: true, summary }
    : {
        ok: true,
        summary: {
          ...summary,
          dryRun: false,
          cancelledRuns: 2,
          variableNote: "LORE_MIRROR was set on acme/public",
          rowDeleted: true,
        },
      };

async function openPreview(move: MirrorMove) {
  render(<MoveMirrorButton mirror="acme/public" move={move} />);
  fireEvent.click(screen.getByRole("button", { name: /Preview the move/ }));
  await screen.findByText("memories");
}

describe("MoveMirrorButton", () => {
  it("calls the dry run first and shows memories moved 4, kept 1", async () => {
    const requests: Request[] = [];

    await openPreview(mover(requests, previewAndMove));

    expect({
      requests,
      row: screen.getByText("memories").closest("tr")?.textContent,
    }).toEqual({
      requests: [{ dry_run: true }],
      row: "memories41",
    });
  });

  it("says nothing would move when every table holds 0 and 0", async () => {
    render(
      <MoveMirrorButton
        mirror="acme/public"
        move={mover([], () => ({
          ok: true,
          summary: {
            ...summary,
            tables: [],
            totalMoved: 0,
            nothingToMove: true,
          },
        }))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview the move/ }));

    expect(await screen.findByText("Nothing would move.")).toBeInTheDocument();
  });

  it("keeps Move disabled until the typed name equals acme/public", async () => {
    await openPreview(mover([], previewAndMove));
    const typed = screen.getByLabelText(/Type acme\/public to confirm/);
    const confirm = () => screen.getByRole("button", { name: "Move now" });
    const states = [confirm().hasAttribute("disabled")];

    fireEvent.change(typed, { target: { value: "acme/publi" } });
    states.push(confirm().hasAttribute("disabled"));
    fireEvent.change(typed, { target: { value: "acme/public" } });
    states.push(confirm().hasAttribute("disabled"));

    expect(states).toEqual([true, true, false]);
  });

  it("sends the confirmed real run and shows 2 runs cancelled and the variable", async () => {
    const requests: Request[] = [];

    await openPreview(mover(requests, previewAndMove));
    fireEvent.change(screen.getByLabelText(/Type acme\/public to confirm/), {
      target: { value: "acme/public" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move now" }));
    await screen.findByText("2 runs cancelled.");

    expect({
      requests: requests.slice(1),
      said: screen.getByRole("status").textContent,
    }).toEqual({
      requests: [{ confirm: "acme/public", dry_run: false }],
      said: "4 rows moved to this repository.2 runs cancelled.LORE_MIRROR was set on acme/public.The mirror's row was removed.",
    });
  });

  it("shows a 409 as text and offers the preview again", async () => {
    render(
      <MoveMirrorButton
        mirror="acme/public"
        move={mover([], () => ({
          ok: false,
          said: "Could not move the mirror's knowledge: this repository has no public mirror saved.",
        }))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview the move/ }));

    expect({
      said: (await screen.findByRole("alert")).textContent,
      again: screen.getByRole("button", { name: /Preview the move/ }),
    }).toMatchObject({
      said: "Could not move the mirror's knowledge: this repository has no public mirror saved.",
      again: { disabled: false },
    });
  });

  it("sends one request when the preview is pressed twice while pending", async () => {
    const requests: Request[] = [];
    let finish: (outcome: MirrorMoveOutcome) => void = () => {};

    render(
      <MoveMirrorButton
        mirror="acme/public"
        move={(request) => {
          requests.push(request);

          return new Promise((resolve) => (finish = resolve));
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview the move/ }));
    const pending = await screen.findByRole("button", {
      name: "Counting what would move…",
    });

    fireEvent.click(pending);
    finish({ ok: true, summary });

    expect({ disabled: pending, requests }).toMatchObject({
      disabled: { disabled: true },
      requests: [{ dry_run: true }],
    });
  });

  it("shows Moving and cannot be pressed twice while the real run is in flight", async () => {
    const requests: Request[] = [];
    let finish: (outcome: MirrorMoveOutcome) => void = () => {};

    await openPreview((request) => {
      requests.push(request);

      return request.dry_run
        ? Promise.resolve({ ok: true, summary })
        : new Promise((resolve) => (finish = resolve));
    });
    fireEvent.change(screen.getByLabelText(/Type acme\/public to confirm/), {
      target: { value: "acme/public" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move now" }));
    const pending = await screen.findByRole("button", {
      name: "Moving the knowledge…",
    });

    fireEvent.click(pending);
    finish(previewAndMove({ dry_run: false }));

    expect({ disabled: pending, sent: requests.length }).toMatchObject({
      disabled: { disabled: true },
      sent: 2,
    });
  });

  it("prevents the default of Enter in the confirmation box so the settings form is not submitted", async () => {
    await openPreview(mover([], previewAndMove));
    const typed = screen.getByLabelText(/Type acme\/public to confirm/);

    expect(fireEvent.keyDown(typed, { key: "Enter" })).toEqual(false);
  });

  it("shows a 403 of the real run as text, drops the stale preview and offers the preview again", async () => {
    await openPreview(
      mover([], (request) =>
        request.dry_run
          ? previewAndMove(request)
          : {
              ok: false,
              said: "Could not move the mirror's knowledge: only an admin can move it.",
            },
      ),
    );
    fireEvent.change(screen.getByLabelText(/Type acme\/public to confirm/), {
      target: { value: "acme/public" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move now" }));

    expect({
      said: (await screen.findByRole("alert")).textContent,
      again: screen.getByRole("button", { name: /Preview the move/ }),
      confirmBox: screen.queryByLabelText(/Type acme\/public to confirm/),
    }).toMatchObject({
      said: "Could not move the mirror's knowledge: only an admin can move it.",
      again: { disabled: false },
      confirmBox: null,
    });
  });
});
