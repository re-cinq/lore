import { z } from "zod";

export const GET_PR_STATUS_INPUT = {
  repo: z.string().describe("'owner/repo'"),
  pr_number: z
    .number()
    .describe("PR number (integer from the PR URL, not a UUID)."),
};
