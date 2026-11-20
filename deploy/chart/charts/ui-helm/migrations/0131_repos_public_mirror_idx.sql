-- 0131_repos_public_mirror_idx: one private repo per public mirror.
--
-- settings.public_mirror names the public repository a private one is
-- published to (specs/public-mirror). The mirror lookup compares names without
-- regard to case, and two private repos naming the same public repo would
-- publish over each other, so the lowercased name is unique across repos that
-- set one. Repos with no public_mirror are outside the index.
--
-- Idempotent: safe to re-run.

CREATE UNIQUE INDEX IF NOT EXISTS repos_public_mirror_idx
  ON lore.repos (lower(settings->>'public_mirror'))
  WHERE settings ? 'public_mirror';
