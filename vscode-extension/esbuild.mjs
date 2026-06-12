import { build, context } from "esbuild";

// The VS Code extension host loads a single CommonJS file and provides the
// `vscode` module itself, so it must stay external. Everything else — including
// the pure parsers from @re-cinq/lore-shared — is bundled in.
const options = {
  entryPoints: ["src/extension.ts"],
  // .cjs (not .js): the package is "type": "module", so a plain .js CJS bundle
  // would be misread as ESM by VS Code's require-based loader and fail to load.
  outfile: "dist/extension.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
};

const watch = process.argv.includes("--watch");
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
