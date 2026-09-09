-- Order status lifecycle for the admin dashboard:
--   on_queue (default) -> preparing -> delivered
--                       \-> cancelled (requires cancellation_reason)

alter table public.orders
  add column if not exists cancellation_reason text;

-- Replace any existing status check constraint with the new allowed values.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('on_queue', 'preparing', 'delivered', 'cancelled'));

alter table public.orders
  alter column status set default 'on_queue';

-- Backfill any legacy rows created before this migration.
update public.orders set status = 'on_queue' where status = 'pending';
