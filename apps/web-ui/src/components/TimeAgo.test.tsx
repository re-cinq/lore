// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TimeAgo } from "./TimeAgo";

const NOW = new Date("2026-07-09T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function renderTime(iso: string): string {
  const { container } = render(<TimeAgo date={iso} nowMs={NOW} />);
  return container.querySelector("time")?.textContent ?? "";
}

describe("TimeAgo", () => {
  it("keeps the absolute date and time visible", () => {
    const iso = ago(3 * HOUR);
    expect(renderTime(iso)).toContain(new Date(iso).toLocaleString());
  });

  it('shows "just now" alongside the timestamp under a minute', () => {
    expect(renderTime(ago(5 * 1000))).toContain("(just now)");
  });

  it("shows hours ago alongside the timestamp within the day", () => {
    expect(renderTime(ago(3 * HOUR))).toContain("(3 hours ago)");
  });

  it("shows days ago alongside the timestamp within the week", () => {
    expect(renderTime(ago(2 * DAY))).toContain("(2 days ago)");
  });

  it("keeps the full timestamp and relative label for old dates", () => {
    const iso = ago(10 * DAY);
    const text = renderTime(iso);
    expect(text).toContain(new Date(iso).toLocaleString());
    expect(text).toContain("(10 days ago)");
  });

  it("renders the raw value for an unparseable date", () => {
    expect(renderTime("not-a-date")).toBe("not-a-date");
  });

  it("renders absolute and relative on one line without a break when inline", () => {
    const iso = ago(3 * HOUR);
    const { container } = render(<TimeAgo date={iso} nowMs={NOW} inline />);
    expect(container.querySelector("br")).toBeNull();
    const text = container.querySelector("time")?.textContent ?? "";
    expect(text).toContain(new Date(iso).toLocaleString());
    expect(text).toContain("(3 hours ago)");
  });
});
