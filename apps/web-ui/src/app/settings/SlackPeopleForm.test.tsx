// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SlackPeopleForm from "./SlackPeopleForm";

describe("SlackPeopleForm", () => {
  it("prefills the textarea with the stored pairs", () => {
    const { container } = render(
      <SlackPeopleForm
        slackPeopleLines={"gedaiu U01BOGDAN"}
        slackPeopleRejected={[]}
        saveSlackPeople={async () => {}}
      />,
    );

    expect(container.querySelector("textarea[name=slack_people]")).toHaveValue(
      "gedaiu U01BOGDAN",
    );
  });

  it("names the lines it refused to save", () => {
    const { container } = render(
      <SlackPeopleForm
        slackPeopleLines={"gedaiu bogdan\nmuemich U04MM"}
        slackPeopleRejected={["gedaiu bogdan"]}
        saveSlackPeople={async () => {}}
      />,
    );

    expect(container.textContent).toContain("Not saved");
    expect(container.textContent).toContain("gedaiu bogdan");
  });
});
