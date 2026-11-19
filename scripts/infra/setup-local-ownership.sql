SELECT set_config('lore.team_schemas', :'team_schemas', false);
GRANT CREATE ON DATABASE lore TO lore;
GRANT CREATE, USAGE ON SCHEMA lore TO lore;
-- web-ui connects as lore_ui and reads lore.* tables (e.g. lore.plans)
-- granted by migrations; it needs schema USAGE too. In
-- the cluster lore_ui already has it; mirror that locally.
GRANT USAGE ON SCHEMA lore TO lore_ui;
ALTER TABLE IF EXISTS lore.schema_migrations OWNER TO lore;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname IN ('lore', 'pipeline', 'memory') OR n.nspname = ANY (string_to_array(current_setting('lore.team_schemas'), ',')))
      AND c.relkind IN ('r','S','v','m')
  LOOP
    IF    r.relkind = 'r' THEN EXECUTE format('ALTER TABLE %I.%I OWNER TO lore', r.nspname, r.relname);
    ELSIF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO lore', r.nspname, r.relname);
    ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW %I.%I OWNER TO lore', r.nspname, r.relname);
    ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO lore', r.nspname, r.relname);
    END IF;
  END LOOP;
END $$;
