// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PackStatusCard, { type PackStatusCardProps } from "./PackStatusCard";

const applied: PackStatusCardProps["pack"] = {
  repo: "acme/lore-pack",
  ref: "main",
  commit: "9a7b72d96c4cbaadf77c7bcdc9f885dfb099c36d",
  applied_at: "2026-11-17T10:30:00.000Z",
  agent_count: 3,
  line_count: 1,
  extra_count: 2,
  refused_files: [],
  agents: ["acme-triage"],
  pipelines: ["acme-flow"],
  error: null,
  error_at: null,
};

function renderCard(pack: Partial<PackStatusCardProps["pack"]> = {}) {
  return render(
    <PackStatusCard
      pack={{ ...applied, ...pack }}
      githubWebUrl="https://ghe.acme.example"
      syncPack={vi.fn()}
    />,
  );
}

describe("PackStatusCard", () => {
  it("shows acme/lore-pack on branch main with the applied commit 9a7b72d, its time, and 3 agents, 1 line, 2 extras", () => {
    renderCard();
    const card = screen.getByRole("region", { name: "Pack" });

    expect({
      text: card.textContent,
      stats: ["agents", "lines", "extras"].map(
        (label) => screen.getByText(label).nextElementSibling?.textContent,
      ),
    }).toEqual({
      text: "Packacme/lore-packbranch: mainAppliedagents3lines1extras2Last applied: 9a7b72d · 2026-11-17 10:30 UTCOpen repoSync now",
      stats: ["3", "1", "2"],
    });
  });

  it("links Open repo to https://ghe.acme.example/acme/lore-pack/tree/main in a new tab", () => {
    renderCard();
    const link = screen.getByRole("link", { name: "Open repo" });

    expect({
      href: link.getAttribute("href"),
      target: link.getAttribute("target"),
      rel: link.getAttribute("rel"),
    }).toEqual({
      href: "https://ghe.acme.example/acme/lore-pack/tree/main",
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });

  it("links Open repo to the repository root when the pack has no ref", () => {
    renderCard({ ref: null });

    expect(
      screen.getByRole("link", { name: "Open repo" }).getAttribute("href"),
    ).toBe("https://ghe.acme.example/acme/lore-pack");
  });

  it("names the default branch when the pack has no ref", () => {
    renderCard({ ref: null });

    expect(screen.getByText(/branch:/).textContent).toBe(
      "branch: default branch",
    );
  });

  it("shows Failed and the error, keeping the last applied commit 9a7b72d, when the last sync failed", () => {
    renderCard({
      error: "pack repo acme/lore-pack not found",
      error_at: "2026-11-17T11:00:00.000Z",
    });

    expect({
      pill: screen.queryByText("Failed")?.textContent,
      applied: screen.queryByText("Applied"),
      error: screen.queryByText("pack repo acme/lore-pack not found")
        ?.textContent,
      lastApplied: screen.getByText(/Last applied/).textContent,
    }).toEqual({
      pill: "Failed",
      applied: null,
      error: "pack repo acme/lore-pack not found",
      lastApplied: "Last applied: 9a7b72d · 2026-11-17 10:30 UTC",
    });
  });

  it("lists each refused file with its reason", () => {
    renderCard({
      refused_files: [
        {
          path: "triage/pipeline.yaml",
          reason: "a shipped pipeline cannot be replaced",
        },
      ],
    });

    expect(
      screen.getAllByRole("listitem").map((refusal) => refusal.textContent),
    ).toEqual(["triage/pipeline.yaml: a shipped pipeline cannot be replaced"]);
  });

  it("shows no refused list when nothing was refused", () => {
    renderCard();

    expect(screen.queryByRole("list")).toBeNull();
  });

  it("submits the form to the sync action when Sync now is clicked", async () => {
    const syncPack = vi.fn();

    render(
      <PackStatusCard
        pack={applied}
        githubWebUrl="https://github.com"
        syncPack={syncPack}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    expect(syncPack).toHaveBeenCalledTimes(1);
  });

  it("shows Not synced yet with a Sync now button before the first sync of acme/lore-pack", () => {
    renderCard({ commit: null, applied_at: null });

    expect({
      pill: screen.queryByText("Waiting")?.textContent,
      applied: screen.queryByText("Applied"),
      lastApplied: screen.getByText(/Not synced yet/).textContent,
      sync: screen.getByRole("button", { name: "Sync now" }).textContent,
    }).toEqual({
      pill: "Waiting",
      applied: null,
      lastApplied: "Not synced yet",
      sync: "Sync now",
    });
  });
});
