import { execSync } from "node:child_process";

/** Both tools run the repo's OWN manifest commands, so both resolve the checkout root first — the manifest is read relative to it, and the commands run in it. */
export async function localManifest(): Promise<{
  root: string;
  manifest: Awaited<
    ReturnType<
      typeof import("../../../../work/spec-trace/spec-trace-tools.js").loadTestCommandManifest
    >
  >;
}> {
  const { loadTestCommandManifest } =
    await import("../../../../work/spec-trace/spec-trace-tools.js");
  const root = checkoutRoot() ?? process.cwd();

  return { root, manifest: loadTestCommandManifest(root) };
}

function checkoutRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}
