-- Remember the language used by each customer on non-website channels.
alter table public.wa_conversations add column if not exists language text not null default 'en';
alter table public.ig_conversations add column if not exists language text not null default 'en';
alter table public.fb_conversations add column if not exists language text not null default 'en';
