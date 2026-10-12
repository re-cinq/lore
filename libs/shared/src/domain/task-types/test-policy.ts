// What the pod's Bash hook lets a test runner do: `scoped` (default) only named files/packages, `none` no tests, installs or builds, `any` hook off. Rides the CR as LORE_TEST_POLICY.

import { z } from "zod";

export const TestPolicySchema = z.enum(["scoped", "none", "any"]);

/** The env entry the pod's guard-tests hook reads; empty for an absent or unrecognised policy so a stale row can never switch the guard off by accident. */
export function testPolicyEnv(
  policy: unknown,
): Array<{ name: string; value: string }> {
  const parsed = TestPolicySchema.safeParse(policy);

  return parsed.success
    ? [{ name: "LORE_TEST_POLICY", value: parsed.data }]
    : [];
}
