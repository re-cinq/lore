-- 0088_drop_features: features are plans now (ADR-047).
--
-- A feature was planned in a wizard over lore.features + lore.feature_iterations;
-- it is now a plan people and the planning agent write together in lore.plans
-- (0087). Nothing reads the two tables any more: the spec graph no longer merges
-- persistent feature rows, the spec-status hook reads the spec path off the
-- spec-task itself, and spec PRs take their title from the planning run's args.
-- Existing feature rows are not carried over — a plan is a different document,
-- and an in-flight feature can be re-planned as one.

DROP TABLE IF EXISTS lore.feature_iterations;
DROP TABLE IF EXISTS lore.features;
