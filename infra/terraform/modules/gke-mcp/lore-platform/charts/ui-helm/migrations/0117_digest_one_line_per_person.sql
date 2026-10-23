-- 0117_digest_one_line_per_person: the daily digest is one line per person
-- (specs/daily-digest FR5), so it is no longer grouped by area and has no
-- closing line. A stored `group_by` or a `morale` section would be data nothing
-- reads, and a `morale` section would fail the settings schema on the next save.

UPDATE lore.repos
   SET settings = jsonb_set(
         settings,
         '{digest,sections}',
         (settings #> '{digest,sections}') - 'morale'
       )
 WHERE settings #> '{digest,sections}' ? 'morale';

UPDATE lore.repos
   SET settings = settings #- '{digest,group_by}'
 WHERE settings -> 'digest' ? 'group_by';
