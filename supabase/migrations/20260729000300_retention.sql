-- Retention.
--
-- Games are hard-deleted thirty days after their last action; cascades clear
-- their players and their action log. There is no archival and no soft delete —
-- a finished game of a board game between friends has no second audience.
--
-- Kept in its own migration because pg_cron has to be enabled on the project
-- before it will apply. If this file fails, the schema is already in place and
-- the only thing missing is the sweep.

create extension if not exists pg_cron;

select cron.schedule(
  'parkway-retention',
  '0 4 * * *',
  $$delete from games where last_action_at < now() - interval '30 days'$$
);
