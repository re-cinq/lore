-- 0095_remove_floor_subscriber: Lore's own Floor (`apps/floor`) is deleted, so
-- nothing claims the `floor` subscriber's deliveries any more (epic #2342).
--
-- A subscription is a row the subscriber upserts at boot and nothing else
-- removes. Left in place, every event the `floor` once subscribed to would keep
-- fanning out one `pending` delivery nobody claims: an unbounded table, and a
-- backlog that reads as an outage. The subscriptions go first so no new
-- delivery is fanned out, then the deliveries that were never claimed.

DELETE FROM pipeline.event_subscriptions WHERE subscriber = 'floor';

DELETE FROM pipeline.event_deliveries WHERE subscriber = 'floor';
