// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import DigestFields from "./DigestFields";

const checked = (container: HTMLElement, name: string): string[] =>
  Array.from(
    container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
  )
    .filter((box) => box.checked)
    .map((box) => box.value);

describe("DigestFields", () => {
  it("renders the digest section prefilled from the stored block", () => {
    const { container } = render(
      <DigestFields
        digest={{
          enabled: true,
          time: "17:30",
          days: [1, 5],
          timezone: "Europe/Bucharest",
          sections: ["roadmap"],
          group_by: "area",
        }}
        slackChannelSet
      />,
    );

    expect({
      enabled: checked(container, "digest_enabled"),
      time: container.querySelector<HTMLInputElement>(
        'input[name="digest_time"]',
      )?.value,
      days: checked(container, "digest_days"),
      timezone: container.querySelector<HTMLSelectElement>(
        'select[name="digest_timezone"]',
      )?.value,
      sections: checked(container, "digest_sections"),
      groupBy: container.querySelector<HTMLSelectElement>(
        'select[name="digest_group_by"]',
      )?.value,
    }).toEqual({
      enabled: ["yes"],
      time: "17:30",
      days: ["1", "5"],
      timezone: "Europe/Bucharest",
      sections: ["roadmap"],
      groupBy: "area",
    });
  });

  it("checks Monday to Friday, 09:00 Berlin and every section when no block is stored", () => {
    const { container } = render(
      <DigestFields digest={undefined} slackChannelSet />,
    );

    expect({
      enabled: checked(container, "digest_enabled"),
      time: container.querySelector<HTMLInputElement>(
        'input[name="digest_time"]',
      )?.value,
      days: checked(container, "digest_days"),
      timezone: container.querySelector<HTMLSelectElement>(
        'select[name="digest_timezone"]',
      )?.value,
      sections: checked(container, "digest_sections"),
    }).toEqual({
      enabled: [],
      time: "09:00",
      days: ["1", "2", "3", "4", "5"],
      timezone: "Europe/Berlin",
      sections: ["implemented", "roadmap", "summary", "morale"],
    });
  });

  it("hints that a Slack channel is needed when none is set", () => {
    const { container } = render(
      <DigestFields digest={undefined} slackChannelSet={false} />,
    );

    expect(container.textContent).toContain(
      "Set a Slack Channel ID above first",
    );
  });

  it("keeps a stored timezone the browser does not list as an option", () => {
    const { container } = render(
      <DigestFields
        digest={{ timezone: "Mars/Olympus_Mons" }}
        slackChannelSet
      />,
    );

    expect(
      container.querySelector<HTMLSelectElement>(
        'select[name="digest_timezone"]',
      )?.value,
    ).toBe("Mars/Olympus_Mons");
  });
});
