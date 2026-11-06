-- 0115_utopia_docs_source_id: name each repo's `docs` Utopia source in its settings (specs/utopia-graph-mirror FR13, FR18).
--
-- Context assembly reads documents from the repo's `docs` source and learns its id from
-- settings.utopia.docs_source_id, the way it learned the one `lore` source's from source_id. The
-- source was made on the first document pushed after 0114, so a repo that has one has it in
-- lore.utopia_kind_sources and not yet in its settings; later ones record it themselves when
-- they create the source. The id is no secret (the key stays in the table), so the settings
-- that read-scope routes serve may hold it.
--
-- Idempotent: it writes the id the table holds, whatever the settings held before.

UPDATE lore.repos AS repos
   SET settings = jsonb_set(
         repos.settings,
         '{utopia,docs_source_id}',
         to_jsonb(sources.source_id)
       )
  FROM lore.utopia_kind_sources AS sources
 WHERE sources.kind = 'docs'
   AND lower(repos.full_name) = lower(sources.repo)
   AND jsonb_typeof(repos.settings -> 'utopia') = 'object';
