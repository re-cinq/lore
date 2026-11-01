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
  const { getRepoRoot } =
    await import("../../../../work/pipeline/runner.local.js");
  const root = getRepoRoot() || process.cwd();

  return { root, manifest: loadTestCommandManifest(root) };
}
