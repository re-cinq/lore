/** Validates a parsed layers.yaml. A package described under the wrong key parses cleanly, matches no file and reports nothing — an adoption that looks done and checks nothing — so every shape mistake here throws instead. */

const TOP_LEVEL = new Set(["layers", "aliases"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Throws on any shape that would silently under-check; returns the parsed doc. */
export function validateLayersConfig(parsed, file = "layers.yaml") {
  if (!isPlainObject(parsed)) {
    throw new Error(`${file}: expected a mapping at the top level`);
  }

  const unknown = Object.keys(parsed).filter((key) => !TOP_LEVEL.has(key));
  if (unknown.length) {
    throw new Error(
      `${file}: unknown top-level key(s) ${unknown.join(", ")} — only ${[...TOP_LEVEL].join(" and ")} are read, so anything else is ignored silently`,
    );
  }

  const layers = parsed.layers ?? {};
  if (!isPlainObject(layers)) {
    throw new Error(
      `${file}: \`layers\` must be a mapping of package to folders`,
    );
  }

  for (const [pkg, entries] of Object.entries(layers)) {
    if (!isPlainObject(entries)) {
      throw new Error(
        `${file}: \`layers.${pkg}\` must be a mapping of folder to imports`,
      );
    }

    for (const [folder, entry] of Object.entries(entries)) {
      validateEntry(file, pkg, folder, entry);
    }
  }

  validateAliases(file, parsed.aliases ?? {}, layers);

  return parsed;
}

function validateEntry(file, pkg, folder, entry) {
  const where = `${file}: \`layers.${pkg}.${folder}\``;

  if (Array.isArray(entry)) return;

  if (!isPlainObject(entry)) {
    throw new Error(
      `${where} must be a list, or a mapping with \`imports\`/\`tests\``,
    );
  }
  const extra = Object.keys(entry).filter(
    (key) => key !== "imports" && key !== "tests",
  );
  if (extra.length) {
    throw new Error(`${where} has unknown key(s) ${extra.join(", ")}`);
  }
  for (const key of ["imports", "tests"]) {
    if (entry[key] !== undefined && !Array.isArray(entry[key])) {
      throw new Error(`${where}.${key} must be a list`);
    }
  }
}

function validateAliases(file, aliases, layers) {
  if (!isPlainObject(aliases)) {
    throw new Error(
      `${file}: \`aliases\` must be a mapping of package to prefixes`,
    );
  }

  for (const [pkg, map] of Object.entries(aliases)) {
    if (!isPlainObject(map)) {
      throw new Error(
        `${file}: \`aliases.${pkg}\` must be a mapping of prefix to path`,
      );
    }
    // Checked before the layers lookup: a package block mis-indented here parses
    // as a mapping whose values are lists, and that is the more useful diagnosis.
    for (const [prefix, target] of Object.entries(map)) {
      if (typeof target !== "string") {
        throw new Error(
          `${file}: \`aliases.${pkg}."${prefix}"\` must be a string path — a package block indented here is read as an alias map and never checked`,
        );
      }
    }
    if (!(pkg in layers)) {
      throw new Error(
        `${file}: \`aliases.${pkg}\` names a package with no \`layers\` entry, so nothing in it is checked`,
      );
    }
  }
}
