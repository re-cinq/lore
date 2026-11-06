-- 0097_remove_node_station_subscriptions: the stations service no longer
-- answers the published-node event (`station.run`) or the approval-check tick
-- (`cron.approval_check.tick`); the node stations and that sweep are deleted.
--
-- A subscription is a row the subscriber upserts at boot and nothing else
-- removes, so the two rows would outlive the code that answered them. Nothing
-- emits either event any more; this keeps the table saying what is subscribed.

DELETE FROM pipeline.event_deliveries
 WHERE subscriber = 'stations'
   AND event_name IN ('station.run', 'cron.approval_check.tick')
   AND status <> 'done';

DELETE FROM pipeline.event_subscriptions
 WHERE subscriber = 'stations'
   AND event_name IN ('station.run', 'cron.approval_check.tick');
