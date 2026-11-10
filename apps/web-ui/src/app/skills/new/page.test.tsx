// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import NewSkillPage from "./page";
import { HELP_BLOCK_TEMPLATE } from "../help-template";

afterEach(cleanup);

describe("NewSkillPage", () => {
  it("renders an editable name and posts the lore-help template as content", () => {
    render(<NewSkillPage />);

    expect(new FormData(document.querySelector("form")!).get("content")).toBe(
      HELP_BLOCK_TEMPLATE,
    );
    expect({
      name: screen.getByLabelText("Name"),
      create: screen.getByRole("button", { name: "Create" }),
    }).toMatchObject({
      name: expect.objectContaining({ value: "", readOnly: false }),
      create: expect.anything(),
    });
  });
});
