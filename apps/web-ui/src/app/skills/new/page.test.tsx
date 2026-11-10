// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import NewSkillPage from "./page";
import { HELP_BLOCK_TEMPLATE } from "../help-template";

afterEach(cleanup);

describe("NewSkillPage", () => {
  it("renders an editable name and the lore-help template as content", () => {
    render(<NewSkillPage />);

    expect({
      name: screen.getByLabelText("Name"),
      content: screen.getByLabelText(/content/i),
      create: screen.getByRole("button", { name: "Create" }),
    }).toMatchObject({
      name: expect.objectContaining({ value: "", readOnly: false }),
      content: expect.objectContaining({ value: HELP_BLOCK_TEMPLATE }),
      create: expect.anything(),
    });
  });
});
