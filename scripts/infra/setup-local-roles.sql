-- The `lore` schema. On GKE it pre-exists (setup-db.sh), and on a dev container
-- that has been through this script before it survives — which is why the GRANT
-- further down never failed locally. On a genuinely EMPTY database it does not
-- exist yet and that GRANT is the first thing to touch it, so create it here.
-- Found by running this script against a fresh database for the first time.
CREATE SCHEMA IF NOT EXISTS lore;

DO $$ BEGIN
  -- The setup-*.sh scripts connect as `postgres` by name (their kubectl calls
  -- hardcode `-U postgres`, matching the cluster). A CI service container has no
  -- such role, so create it rather than rewrite five scripts' invocations —
  -- making the environment match what they already expect is the smaller change,
  -- and it keeps those scripts byte-identical between CI and the cluster.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres SUPERUSER LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore') THEN
    CREATE ROLE lore LOGIN PASSWORD 'lore';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    CREATE ROLE lore_ui LOGIN PASSWORD 'lore';
  END IF;
END $$;
