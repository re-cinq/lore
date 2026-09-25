// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SlackPeopleForm from "./SlackPeopleForm";

describe("SlackPeopleForm", () => {
  it("prefills the textarea with the stored pairs", () => {
    const { container } = render(
      <SlackPeopleForm
        slackPeopleLines={"gedaiu U01BOGDAN"}
        saveSlackPeople={async () => {}}
      />,
    );

    expect(container.querySelector("textarea[name=slack_people]")).toHaveValue(
      "gedaiu U01BOGDAN",
    );
  });
});
