-- Facebook Messenger order bot: Page connection, conversation state, messages,
-- settings, and admin-managed keyword replies.
create extension if not exists pgcrypto;

create table if not exists public.fb_connection (
  id smallint primary key default 1 check (id = 1),
  page_id text,
  page_name text,
  access_token text,
  app_secret text,
  updated_at timestamptz not null default now()
);
insert into public.fb_connection (id) values (1) on conflict (id) do nothing;

create table if not exists public.fb_conversations (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null unique,
  profile_name text,
  stage text not null default 'idle'
    check (stage in ('idle', 'ask_name', 'ask_table', 'ask_items', 'confirm', 'placing_order')),
  customer_name text,
  table_no text,
  cart jsonb not null default '[]'::jsonb,
  last_message_at timestamptz not null default now(),
  last_greeted_date date,
  followup_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.fb_messages (
  id text primary key,
  conversation_id uuid references public.fb_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text,
  created_at timestamptz not null default now()
);
create index if not exists fb_messages_conversation_idx on public.fb_messages (conversation_id, created_at);

create table if not exists public.fb_settings (
  id smallint primary key default 1 check (id = 1),
  welcome_message text not null default E'👋 Welcome! I''m here to help you order.\n\nWhat would you like to do?',
  order_button_label text not null default '🛒 Place an order',
  location_button_label text not null default '📍 Location',
  menu_button_label text not null default '💰 Menu & prices',
  followup_message text not null default 'Still there? Just reply whenever you''re ready to continue 🙂',
  followup_delay_minutes int not null default 15,
  owner_fb_sender_id text,
  updated_at timestamptz not null default now()
);
insert into public.fb_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.fb_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  match_type text not null default 'contains' check (match_type in ('contains', 'exact')),
  response text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.fb_keywords (keyword, match_type, response, sort_order)
select * from (values
  ('location', 'contains', 'Edit this reply in the Messenger admin panel with your real address and a map link 📍', 0),
  ('hours', 'contains', 'Edit this reply in the Messenger admin panel with your real opening hours 🕒', 1),
  ('price', 'contains', 'You can see our full menu and prices any time - just ask, or tap "Menu & prices" 💰', 2)
) as seed(keyword, match_type, response, sort_order)
where not exists (select 1 from public.fb_keywords);
