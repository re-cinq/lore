-- 0074_github_installations: the GitHub App installations Lore can act through
-- (specs/4-ux-repo-onboarding FR-8, the Connect GitHub flow).
--
-- One row per account (org or user) the App is installed on. Until now the
-- installation was a single id fixed in every deployable's environment
-- (GITHUB_APP_INSTALLATION_ID), so Lore could only ever serve the one org it
-- covered; a repo is now served by the installation of its owner.
--
-- GitHub allows one installation of an App per account, so the account login is
-- unique — case-insensitively, as GitHub logins are. The unique index is on
-- lower(account_login), and it is also the index findByAccount reads through.
-- installation_id is GitHub's own int64 id: the key the install callback and the
-- installation webhooks name.

CREATE TABLE IF NOT EXISTS lore.github_installations (
  installation_id      BIGINT PRIMARY KEY,
  account_login        TEXT NOT NULL,
  account_type         TEXT NOT NULL
                         CHECK (account_type IN ('Organization', 'User')),
  repository_selection TEXT NOT NULL
                         CHECK (repository_selection IN ('all', 'selected')),
  -- Set while the account has suspended the App: no token can be minted through it.
  suspended_at         TIMESTAMPTZ,
  installed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS github_installations_account_login
  ON lore.github_installations (lower(account_login));
