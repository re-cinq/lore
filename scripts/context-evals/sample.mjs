// Which documents a repository's context eval looks at tonight: a window of `size` that moves on by `size` every day over a fixed shuffle of the documents, so every document is evaluated once every ceil(n / size) nights and a repeated run of one night picks the same ones.

const DAY_MS = 86_400_000;

export function sampleDocuments(paths, date, size) {
  const sorted = paths.toSorted();

  if (sorted.length <= size) {
    return sorted;
  }
  const shuffled = sorted.toSorted(
    (left, right) => fnv1a(left) - fnv1a(right) || byCodeUnit(left, right),
  );
  const start = (dayNumber(date) * size) % shuffled.length;

  return Array.from(
    { length: size },
    (_, offset) => shuffled[(start + offset) % shuffled.length],
  );
}

// Not localeCompare: a runner's locale must not change which documents a night picks.
function byCodeUnit(left, right) {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function dayNumber(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

// A fixed hash, so the shuffle is the same on every runner: neighbouring paths (one feature's spec and ADR) land in different nights.
function fnv1a(text) {
  let hash = 0x811c9dc5;

  for (const char of text) {
    hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193) >>> 0;
  }

  return hash;
}
