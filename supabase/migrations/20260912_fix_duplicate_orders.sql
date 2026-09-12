-- Fix: WhatsApp/Instagram orders could be recorded twice for a single
-- "Confirm" tap.
--
-- Root cause: Meta retries webhook deliveries whenever it doesn't get a fast
-- 2xx (or just as a matter of at-least-once delivery), and Instagram's
-- button-template taps arrive as `messaging_postbacks` events that don't
-- reliably include a message id ("mid") - so the message-id dedupe in
-- igBot.js/waBot.js had nothing to key on and the "confirm" branch could run
-- twice for the same tap, inserting two rows into `orders`.
--
-- Fix: the confirm handler now does an atomic compare-and-swap on
-- `stage` (UPDATE ... WHERE stage = 'confirm') before it ever inserts an
-- order. Only one concurrent/duplicate delivery can win that update: the
-- loser sees zero rows affected and stops without creating an order. This
-- needs a transitional stage value to swap into, so it's added here.

alter table public.wa_conversations drop constraint if exists wa_conversations_stage_check;
alter table public.wa_conversations add constraint wa_conversations_stage_check
  check (stage in ('idle', 'ask_name', 'ask_table', 'ask_items', 'confirm', 'placing_order'));

alter table public.ig_conversations drop constraint if exists ig_conversations_stage_check;
alter table public.ig_conversations add constraint ig_conversations_stage_check
  check (stage in ('idle', 'ask_name', 'ask_table', 'ask_items', 'confirm', 'placing_order'));
