/** Maps a file path to a highlight.js language token ('' renders as plain text) — labels the fence a code chunk renders through. */
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  xml: "xml",
  html: "xml",
  htm: "xml",
  css: "css",
  scss: "scss",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "dockerfile",
  proto: "protobuf",
  graphql: "graphql",
  gql: "graphql",
};

export function languageForPath(filePath: string): string {
  const base = (filePath.split("/").pop() ?? "").toLowerCase();

  if (base === "dockerfile") {
    return "dockerfile";
  }
  const dot = base.lastIndexOf(".");

  if (dot < 0) {
    return "";
  }

  return EXT_LANG[base.slice(dot + 1)] ?? "";
}

/** A backtick fence one longer than the longest run in the content, so CommonMark's closing-fence-length rule can't let the content close it early. */
export function fenceFor(content: string): string {
  let longest = 0;

  for (const m of content.matchAll(/`+/g)) {
    longest = Math.max(longest, m[0].length);
  }

  return "`".repeat(Math.max(3, longest + 1));
}
