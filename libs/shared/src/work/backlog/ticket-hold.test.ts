import { describe, expect, it } from "vitest";
import { MAX_TASK_DESCRIPTION_CHARS } from "../../domain/task-description.js";
import { ticketHold } from "./ticket-hold.js";

const queued = { title: "Add a health route", labels: ["priority:high"] };

describe("ticketHold", () => {
  it("returns null for a queued ticket nothing holds", () => {
    expect(ticketHold({ issue: queued, openBlockers: [] })).toBeNull();
  });

  it("returns text_too_long with a shorten-the-text fix when the body is past the limit", () => {
    const issue = { ...queued, body: "x".repeat(MAX_TASK_DESCRIPTION_CHARS) };

    expect(ticketHold({ issue, openBlockers: [] })).toEqual({
      kind: "text_too_long",
      message:
        "The issue's title and body are longer than a task description may be, so the loop will not pick it.",
      fix: "Shorten the issue text.",
    });
  });

  it("names open blockers #12 and #15 and how to lift them", () => {
    expect(ticketHold({ issue: queued, openBlockers: [12, 15] })).toEqual({
      kind: "waits_on_blockers",
      message: "Waits on #12, #15, which are still open.",
      fix: "Close them, or remove the blocked-by link if it no longer applies.",
    });
  });

  it("says one blocker #12 in the singular", () => {
    expect(
      ticketHold({ issue: queued, openBlockers: [12] })?.message,
    ).toEqual("Waits on #12, which is still open.");
  });

  it("returns two_priorities for priority:high plus priority:low", () => {
    const issue = { ...queued, labels: ["priority:high", "priority:low"] };

    expect(ticketHold({ issue, openBlockers: [] })).toEqual({
      kind: "two_priorities",
      message: "Carries two priority labels, so the loop cannot rank it.",
      fix: "Keep exactly one priority label.",
    });
  });

  it("quotes the stored reason on a lore:blocked ticket and says to remove the label", () => {
    const issue = { ...queued, labels: ["priority:high", "lore:blocked"] };
    const lastAttempt = {
      status: "completed",
      why: "the definition-of-done step could not express this ticket as acceptance tests: it asks for a decision",
    };

    expect(ticketHold({ issue, openBlockers: [], lastAttempt })).toEqual({
      kind: "parked",
      message:
        "The loop parked this ticket: the definition-of-done step could not express this ticket as acceptance tests: it asks for a decision.",
      fix: "Fix what it names, then remove the lore:blocked label to re-queue it.",
    });
  });

  it("points a lore:blocked ticket with no stored reason at the issue's comments", () => {
    const issue = { ...queued, labels: ["priority:high", "lore:blocked"] };

    expect(ticketHold({ issue, openBlockers: [] })?.message).toEqual(
      "The loop parked this ticket; the reason is in the issue's comments.",
    );
  });

  it("returns failed with the classifier's hint for a 403 on the last attempt", () => {
    const lastAttempt = {
      status: "failed",
      why: "the run ended failed: 403 Forbidden",
    };

    expect(ticketHold({ issue: queued, openBlockers: [], lastAttempt })).toEqual(
      {
        kind: "failed",
        message: "The last attempt failed: the run ended failed: 403 Forbidden.",
        fix: "Check the Lore GitHub App's repository permissions and that it is installed on the target repo.",
      },
    );
  });

  it("tells the reader an unclaimed attempt needs nothing from them", () => {
    const lastAttempt = {
      status: "failed",
      why: "the run ended failed: unclaimed: no worker took the dispatch",
    };

    expect(
      ticketHold({ issue: queued, openBlockers: [], lastAttempt })?.fix,
    ).toEqual(
      "Nothing to do: the cluster failed, not the ticket, and the loop picks it again on its next tick.",
    );
  });

  it("sends an unrecognized failure to the run", () => {
    const lastAttempt = { status: "failed", why: "the run ended error" };

    expect(
      ticketHold({ issue: queued, openBlockers: [], lastAttempt })?.fix,
    ).toEqual("Open the run to see where it stopped.");
  });

  it("holds a failed ticket whose issue is gone on its failure alone", () => {
    const lastAttempt = { status: "failed", why: null };

    expect(ticketHold({ openBlockers: [], lastAttempt })).toEqual({
      kind: "failed",
      message: "The last attempt failed.",
      fix: "Open the run to see where it stopped.",
    });
  });

  it("returns null for a completed attempt on an unparked ticket", () => {
    const lastAttempt = { status: "completed", why: null };

    expect(
      ticketHold({ issue: queued, openBlockers: [], lastAttempt }),
    ).toBeNull();
  });

  it("puts text too long ahead of open blockers and a failed attempt", () => {
    const issue = { ...queued, body: "x".repeat(MAX_TASK_DESCRIPTION_CHARS) };
    const lastAttempt = { status: "failed", why: "the run ended error" };

    expect(ticketHold({ issue, openBlockers: [12], lastAttempt })?.kind).toEqual(
      "text_too_long",
    );
  });
});
