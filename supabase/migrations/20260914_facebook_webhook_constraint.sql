-- Add Messenger to installations that already created webhook_events.
alter table public.webhook_events drop constraint if exists webhook_events_platform_check;
alter table public.webhook_events add constraint webhook_events_platform_check check (platform in ('whatsapp', 'instagram', 'facebook'));
